import { useEffect, useMemo, useRef, useState } from "react";
import {
  PART_TIME_LIMIT_SEC,
  SPEAKING_LEVELS,
  checkGrammarRequirements,
  dailyWordsEnabled,
  evaluateAnswer,
  fetchDailyWords,
  fetchGrammarCheck,
  fetchSpeakingExamParts,
  fetchSpeakingItems,
  fetchSpeakingPlan,
  fetchSpeakingReply,
  getDeviceId,
  loadSpeakingProgress,
  loadSpeakingSessions,
  markDailyWordsLearned,
  reportToMarkdown,
  saveSpeakingError,
  saveSpeakingProgress,
  saveSpeakingSession,
  speakGerman,
  partLabel,
  topMissingPoints,
  type DailyWord,
  type ExamAid,
  type ExamPartMode,
  type GrammarCheck,
  type GrammarRequirement,
  type RecentWord,
  type SpeakingExamPart,
  type SpeakingFeedback,
  type SpeakingItem,
  type SpeakingLevel,
  type SpeakingSessionReport,
  type SpeakingTurn,
} from "../game/speaking";
import { sfx } from "../game/audio";
import { EXAM_BLUEPRINTS, isOfficialExam } from "../game/examBlueprint";
import ExamAidPanel from "./ExamAidPanel";
import VoiceAnswerInput from "./VoiceAnswerInput";
import { ArrowLeftIcon, CheckIcon } from "./icons";

type Props = {
  onExit: () => void;
  /** 从关卡进入时锁定等级，并直接开始考试 */
  initialLevel?: SpeakingLevel;
  /** 关卡中配置的口语话题（B1/B2 用作考试主题） */
  topic?: string;
  /** 关卡中配置的口语方案 ID：提供时只抽取该方案内的题目 */
  planId?: string;
  /** 完成整场考试后回调（用于标记关卡完成） */
  onFinish?: () => void;
};

type Phase = "select" | "exam" | "report";

interface PartGroup {
  key: string;
  title: string;
  mode: ExamPartMode;
  durationSec: number;
  maxFollowups: number;
  role: "examiner" | "partner";
  aid?: ExamAid;
  items: SpeakingItem[];
}

interface ChatMessage {
  id: number;
  role: "user" | "examiner" | "partner";
  text: string;
  feedback?: SpeakingFeedback;
  /** 非用户消息的来源：LLM 生成或模板兜底 */
  source?: "llm" | "template";
  /** 用户回答的语法批改结果；null 表示语法检查不可用 */
  grammar?: GrammarCheck | null;
  /** 语法检查进行中 */
  checking?: boolean;
}

/** 本场内累计的语法要求达成状态。 */
interface RequirementState extends GrammarRequirement {
  /** 需要达成次数，来自 min_uses */
  required: number;
  achieved: number;
  met: boolean;
  evidence: string[];
  attempts: number;
}

const PART_ORDER = ["part1_intro", "part2_presentation", "part3_discussion"];

const WORD_TYPE_LABELS: Record<string, string> = {
  noun: "名词",
  verb: "动词",
  adj: "形容词",
  adv: "副词",
  pronoun: "代词",
  preposition: "介词",
  conj: "连词",
  article: "冠词",
  num: "数词",
  phrase: "短语",
};

const GENDER_LABELS: Record<string, string> = {
  m: "阳性",
  f: "阴性",
  n: "中性",
  mf: "阴阳性",
};

/** 拼接每日新词的词性 / 性别 / 复数说明。 */
function dailyWordMeta(word: DailyWord): string {
  const parts: string[] = [];
  if (word.word_type) parts.push(WORD_TYPE_LABELS[word.word_type] ?? word.word_type);
  if (word.gender) parts.push(GENDER_LABELS[word.gender] ?? word.gender);
  if (word.plural) parts.push(`复数 ${word.plural}`);
  return parts.join(" · ");
}
/** 发送给后端的最大历史消息数，覆盖整场考试（约 3 部分 × 多题），用于判重。 */
const MAX_HISTORY_TURNS = 80;

const LEVEL_COLORS: Record<SpeakingLevel, string> = {
  A1: "#4FBF58",
  A2: "#2F86D6",
  B1: "#FF8A3D",
  B2: "#F2588E",
  C1: "#8E44AD",
  C2: "#6C3483",
};

const normalizeDE = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.,!?;:"'„“”()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 该题问句是否已在本场对话里问过（含 LLM 追问），用于换题时跳过重复问题。 */
function wasAsked(prompt: string, history: ChatMessage[]): boolean {
  const target = normalizeDE(prompt);
  if (target.length < 8) return false;
  return history.some((msg) => {
    if (msg.role === "user") return false;
    const text = normalizeDE(msg.text);
    if (text.length >= 8 && target.includes(text)) return true;
    return text.includes(target);
  });
}

export default function SpeakingExamView({ onExit, initialLevel, topic, planId, onFinish }: Props) {
  const [phase, setPhase] = useState<Phase>("select");
  const [level, setLevel] = useState<SpeakingLevel>(initialLevel ?? "A1");
  const [items, setItems] = useState<SpeakingItem[]>([]);
  const [examParts, setExamParts] = useState<SpeakingExamPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [partIndex, setPartIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [exchanges, setExchanges] = useState(0);
  const [report, setReport] = useState<SpeakingSessionReport | null>(null);

  const startedAtRef = useRef<number>(0);
  const statsRef = useRef({
    turns: 0,
    pointsTotal: 0,
    pointsCovered: 0,
    missing: {} as Record<string, number>,
    itemsDone: 0,
    completedKeys: [] as string[],
    latencies: [] as number[],
    words: 0,
    duplicateWords: 0,
    perItem: {} as Record<
      string,
      { prompt_de: string; covered: string[]; missing: string[]; turns: number; latencySum: number }
    >,
  });
  const msgID = useRef(0);
  const replySeq = useRef(0);
  const questionShownAt = useRef(0);
  const partStartedAt = useRef(0);
  const timedOutRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /** 与 messages 同步的最新副本，供计时器等非渲染闭包使用。 */
  const messagesRef = useRef<ChatMessage[]>([]);
  const [remainingSec, setRemainingSec] = useState(0);
  /** 本部分时间到：只提示，不再自动提问。 */
  const [timeUp, setTimeUp] = useState(false);
  const [autoRead, setAutoRead] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [recent, setRecent] = useState<SpeakingSessionReport[]>([]);

  // 本机设备标识与每日新词（记录只保存在本机）
  const deviceId = useRef(getDeviceId());
  const [dailyWords, setDailyWords] = useState<DailyWord[]>([]);
  const [dailyDate, setDailyDate] = useState("");
  const [dailyLoaded, setDailyLoaded] = useState(false);
  const [markedWords, setMarkedWords] = useState<number[]>([]);

  // 语法要求：整场累计，未达成时阻断推进
  const [requirements, setRequirements] = useState<RequirementState[]>([]);
  const requirementsRef = useRef<RequirementState[]>([]);
  // 同一句回答只计一次，避免重复提交刷达成次数
  const evaluatedAnswersRef = useRef<Set<string>>(new Set());
  const [pendingAdvance, setPendingAdvance] = useState(false);
  const [supplementMode, setSupplementMode] = useState(false);
  const [supplementText, setSupplementText] = useState("");
  const [supplementAttempts, setSupplementAttempts] = useState(0);
  const [supplementError, setSupplementError] = useState("");

  // 最近五天新词提示与使用统计
  const [recentWords, setRecentWords] = useState<RecentWord[]>([]);
  const recentUsedRef = useRef<Set<string>>(new Set());
  const planID = planId ? Number(planId) : 0;

  const load = () => {
    setLoading(true);
    setError(null);
    const itemsPromise = planId
      ? fetchSpeakingPlan(planId, deviceId.current).then((detail) => {
          const nextRequirements = (detail.plan.grammar_requirements ?? []).map(
            (item): RequirementState => ({
              ...item,
              required: item.min_uses,
              achieved: 0,
              met: false,
              evidence: [],
              attempts: 0,
            }),
          );
          requirementsRef.current = nextRequirements;
          setRequirements(nextRequirements);
          setRecentWords(detail.recent_words ?? []);
          return detail.items;
        })
      : fetchSpeakingItems({ lang: "de" });
    Promise.all([itemsPromise, fetchSpeakingExamParts({ lang: "de" })])
      .then(([list, parts]) => {
        setItems(list);
        setExamParts(parts);
        if (initialLevel) return;
        // 优先选中已配置考试结构或已有题目的等级。
        const first = SPEAKING_LEVELS.find(
          (lv) => parts.some((p) => p.level === lv) || list.some((it) => it.level === lv),
        );
        if (first) setLevel(first);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // 选择页展示今日新词；未配置 API Key 时保持隐藏
  useEffect(() => {
    if (phase !== "select" || initialLevel || !dailyWordsEnabled()) return;
    let cancelled = false;
    fetchDailyWords(deviceId.current, level).then((result) => {
      if (cancelled) return;
      setDailyWords(result.words ?? []);
      setDailyDate(result.date);
      setDailyLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, level, initialLevel]);

  const markAllDailyWords = async () => {
    const ids = dailyWords
      .map((word) => word.word_id)
      .filter((id) => !markedWords.includes(id));
    if (ids.length === 0) return;
    const ok = await markDailyWordsLearned(deviceId.current, ids);
    if (ok) setMarkedWords((prev) => [...prev, ...ids]);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const blueprint = EXAM_BLUEPRINTS[level];

  const parts = useMemo<PartGroup[]>(() => {
    // A1/A2：考试结构与题目全部来自数据库（speaking_exam_parts + speaking_items）。
    if (isOfficialExam(level)) {
      return examParts
        .filter((part) => part.level === level)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(
          (part): PartGroup => ({
            key: part.part_key,
            title: part.title,
            mode: part.mode,
            durationSec: part.duration_sec,
            maxFollowups: part.max_followups,
            role: part.role,
            aid: part.aid ?? undefined,
            items: items.filter(
              (it) => it.level === level && it.exam_part === part.part_key,
            ),
          }),
        )
        .filter((part) => part.items.length > 0);
    }
    // B1/B2：题目来自题库，蓝图只提供部分标题、时长与追问上限。
    return PART_ORDER.map((key): PartGroup => {
      const meta = (blueprint ?? []).find((part) => part.key === key);
      return {
        key,
        title: meta?.title ?? partLabel(key),
        mode:
          meta?.mode ??
          (key === "part3_discussion"
            ? "discussion"
            : key === "part2_presentation"
              ? "presentation"
              : "intro"),
        durationSec: meta?.durationSec ?? PART_TIME_LIMIT_SEC[key] ?? 240,
        maxFollowups: meta?.maxFollowups ?? 2,
        role: meta?.role ?? (key === "part3_discussion" ? "partner" : "examiner"),
        aid: topic ? { kind: "topic", label: "本场考试主题", text: topic } : undefined,
        items: items.filter((it) => it.level === level && it.exam_part === key),
      };
    }).filter((part) => part.items.length > 0);
  }, [items, examParts, level, topic, blueprint]);

  const currentPart = parts[partIndex] ?? null;
  const currentItem = currentPart?.items[itemIndex] ?? null;
  const totalItems = parts.reduce((sum, part) => sum + part.items.length, 0);

  const pushMessage = (
    role: ChatMessage["role"],
    text: string,
    feedback?: SpeakingFeedback,
    source?: ChatMessage["source"],
  ): number => {
    msgID.current += 1;
    const msg: ChatMessage = { id: msgID.current, role, text, feedback, source };
    // 同步维护 ref，供计时器等闭包场景读取最新对话，避免重复提问。
    const next = [...messagesRef.current, msg];
    messagesRef.current = next;
    setMessages(next);
    if (role !== "user") {
      questionShownAt.current = Date.now();
    }
    return msg.id;
  };

  /** 局部更新某条消息（语法批改是异步返回的）。 */
  const patchMessage = (id: number, patch: Partial<ChatMessage>) => {
    const next = messagesRef.current.map((msg) => (msg.id === id ? { ...msg, ...patch } : msg));
    messagesRef.current = next;
    setMessages(next);
  };

  /** 统计新词是否出现在回答中（小写词形包含匹配）。 */
  const trackRecentWords = (text: string) => {
    if (recentWords.length === 0) return;
    const lower = text.toLowerCase();
    const used = recentUsedRef.current;
    let changed = false;
    for (const word of recentWords) {
      if (!used.has(word.lemma) && lower.includes(word.lemma.toLowerCase())) {
        used.add(word.lemma);
        changed = true;
      }
    }
    // 使用统计在结束时从 ref 汇总，不需要即时渲染
    if (changed) recentUsedRef.current = used;
  };

  /**
   * 调用服务端判定语法要求，并累计本场达成状态。
   * 返回全部 block 要求是否已达成；服务不可用时放行，避免死锁。
   */
  const evaluateRequirements = async (text: string): Promise<boolean> => {
    if (!planID || requirementsRef.current.length === 0) return true;
    const normalized = text.trim().toLowerCase();
    if (!normalized) return !hasUnmetBlocking();
    // 同一句回答只计 1 次（方案 9.2）
    if (evaluatedAnswersRef.current.has(normalized)) return !hasUnmetBlocking();
    evaluatedAnswersRef.current.add(normalized);
    const alreadyMet = requirementsRef.current.filter((r) => r.met).map((r) => r.key);
    const result = await checkGrammarRequirements({
      planId: planID,
      level,
      answer: text,
      alreadyMet,
    });
    if (!result) return true;

    const next = requirementsRef.current.map((req): RequirementState => {
      const hit = result.results.find((item) => item.key === req.key);
      const gained = hit && hit.evidence.length > 0 ? 1 : 0;
      const achieved = Math.min(req.required, req.achieved + gained);
      const evidence =
        gained && hit
          ? Array.from(new Set([...req.evidence, ...hit.evidence]))
          : req.evidence;
      return {
        ...req,
        achieved,
        evidence,
        met: achieved >= req.required,
        attempts: req.met ? req.attempts : req.attempts + 1,
      };
    });
    requirementsRef.current = next;
    setRequirements(next);
    return !next.some((req) => req.enforce === "block" && !req.met);
  };

  const hasUnmetBlocking = () =>
    requirementsRef.current.some((req) => req.enforce === "block" && !req.met);

  const unmetRequirementLabels = () =>
    requirementsRef.current
      .filter((req) => req.enforce === "block" && !req.met)
      .map((req) => req.label);

  useEffect(() => {
    if (phase !== "select") return;
    setRecent(loadSpeakingSessions().slice(0, 3));
  }, [phase]);

  const startExam = () => {
    if (parts.length === 0) return;
    startedAtRef.current = Date.now();
    replySeq.current = 0;
    partStartedAt.current = Date.now();
    timedOutRef.current = false;
    setTimeUp(false);
    setRemainingSec(parts[0].durationSec);
    statsRef.current = {
      turns: 0,
      pointsTotal: 0,
      pointsCovered: 0,
      missing: {},
      itemsDone: 0,
      completedKeys: [],
      latencies: [],
      words: 0,
      duplicateWords: 0,
      perItem: {},
    };
    setMessages([]);
    messagesRef.current = [];
    setAnswer("");
    setPartIndex(0);
    setItemIndex(0);
    setExchanges(0);
    setReport(null);
    // 重置语法要求与新词统计
    const resetRequirements = requirementsRef.current.map((req) => ({
      ...req,
      achieved: 0,
      met: false,
      evidence: [],
      attempts: 0,
    }));
    requirementsRef.current = resetRequirements;
    setRequirements(resetRequirements);
    evaluatedAnswersRef.current = new Set();
    recentUsedRef.current = new Set();
    setPendingAdvance(false);
    setSupplementMode(false);
    setSupplementText("");
    setSupplementAttempts(0);
    setSupplementError("");
    setPhase("exam");
    pushMessage(parts[0].role, parts[0].items[0].prompt_de);
    sfx.tap();
  };

  const finishExam = () => {
    const stats = statsRef.current;
    const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const missingSorted = Object.entries(stats.missing)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([point]) => point);
    const avgLatency =
      stats.latencies.length > 0
        ? Math.round(stats.latencies.reduce((sum, v) => sum + v, 0) / stats.latencies.length)
        : 0;
    const maxLatency = stats.latencies.length > 0 ? Math.max(...stats.latencies) : 0;
    const repetitionRatio = stats.words > 0 ? stats.duplicateWords / stats.words : 0;
    const items = Object.entries(stats.perItem).map(([key, value]) => ({
      item_key: key,
      prompt_de: value.prompt_de,
      covered: value.covered,
      missing: value.missing,
      turns: value.turns,
      avg_response_ms: value.turns > 0 ? Math.round(value.latencySum / value.turns) : 0,
    }));
    const speakingMs = stats.latencies.reduce((sum, v) => sum + v, 0);
    const wordsPerMin = speakingMs > 0 ? Math.round(stats.words / (speakingMs / 60000)) : 0;
    const result: SpeakingSessionReport = {
      id: `sp-${Date.now()}`,
      level,
      started_at: new Date(startedAtRef.current).toISOString(),
      ended_at: new Date().toISOString(),
      duration_sec: duration,
      parts: parts.map((part) => part.key),
      turn_count: stats.turns,
      items_total: totalItems,
      items_completed: stats.itemsDone,
      points_total: stats.pointsTotal,
      points_covered: stats.pointsCovered,
      missing_points: missingSorted,
      suggested_review:
        missingSorted.length > 0
          ? `建议重点复习这些要点：${missingSorted.join("、")}`
          : "要点覆盖良好，继续保持，并尝试用更完整的句子表达。",
      avg_response_ms: avgLatency,
      max_response_ms: maxLatency,
      repetition_ratio: repetitionRatio,
      words_per_min: wordsPerMin,
      items,
      requirements: requirementsRef.current.map((req) => ({
        key: req.key,
        label: req.label,
        enforce: req.enforce,
        required: req.required,
        achieved: req.achieved,
        met: req.met,
        evidence: req.evidence,
        attempts: req.attempts,
      })),
      recent_words: recentWords,
      recent_words_used: [...recentUsedRef.current],
    };
    saveSpeakingSession(result);
    const boosted = Array.from(
      new Set([...loadSpeakingProgress().completed, ...stats.completedKeys]),
    );
    saveSpeakingProgress({ completed: boosted });
    setReport(result);
    setPhase("report");
    onFinish?.();
    sfx.win();
  };

  /** 结束前检查阻断型语法要求；未达成时进入补答，而不是直接结束。 */
  const requestFinish = () => {
    if (busy) return;
    if (!hasUnmetBlocking()) {
      finishExam();
      return;
    }
    setPendingAdvance(false);
    setSupplementMode(true);
    setSupplementAttempts(0);
    setSupplementText("");
    setSupplementError("");
  };

  /** 补答：自由回答一句完整句子，最多 3 次。 */
  const submitSupplement = async () => {
    const text = supplementText.trim();
    if (!text || busy) return;
    setBusy(true);
    trackRecentWords(text);
    const allMet = await evaluateRequirements(text);
    setBusy(false);
    setSupplementText("");
    if (allMet) {
      finishExam();
      return;
    }
    const next = supplementAttempts + 1;
    setSupplementAttempts(next);
    if (next >= 3) {
      setSupplementError("补答 3 次仍未达成，可直接结束并记录未达成。");
    }
  };

  /** 3 次补答后的兜底出口：二次确认后结束并记录未达成。 */
  const endWithoutMet = () => {
    if (!window.confirm("语法要求尚未达成，结束后报告会标记为未达成。确定结束吗？")) return;
    finishExam();
  };

  // 从关卡进入时锁定等级，等考试配置/题库就绪后直接开考。
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!initialLevel || autoStarted.current || phase !== "select") return;
    if (parts.length === 0) return;
    autoStarted.current = true;
    startExam();
  }, [initialLevel, phase, parts]);

  /** 从 (fromPart, fromItem) 起找到第一道「问句还没出现过」的题；都问过则返回 null。 */
  const findNextUnasked = (fromPart: number, fromItem: number) => {
    for (let p = fromPart; p < parts.length; p++) {
      for (let i = p === fromPart ? fromItem : 0; i < parts[p].items.length; i++) {
        if (!wasAsked(parts[p].items[i].prompt_de, messagesRef.current)) {
          return { part: p, item: i };
        }
      }
    }
    return null;
  };

  /** 跳到指定部分的指定题目，并重置该部分的计时。 */
  const jumpToPart = (index: number, itemStart = 0) => {
    const nextPart = parts[index];
    const nextItem = nextPart?.items[itemStart];
    if (!nextPart || !nextItem) return;
    setPartIndex(index);
    setItemIndex(itemStart);
    setExchanges(0);
    partStartedAt.current = Date.now();
    timedOutRef.current = false;
    setTimeUp(false);
    setRemainingSec(nextPart.durationSec);
    pushMessage(nextPart.role, nextItem.prompt_de);
  };

  const advance = () => {
    if (!currentPart) return;
    // 同一话题下有多道题，若某题问句已经在追问中出现过就跳过，避免换题后重复提问。
    const next = findNextUnasked(partIndex, itemIndex + 1);
    if (!next) {
      requestFinish();
      return;
    }
    if (next.part !== partIndex) {
      jumpToPart(next.part, next.item);
      return;
    }
    const nextItem = currentPart.items[next.item];
    setItemIndex(next.item);
    setExchanges(0);
    pushMessage(currentPart.role, nextItem.prompt_de);
  };

  // 部分计时：到时只提示，不再自动提问；由考生决定继续作答还是进入下一部分。
  useEffect(() => {
    if (phase !== "exam" || !currentPart) return;
    const limit = currentPart.durationSec;
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - partStartedAt.current) / 1000);
      const left = Math.max(0, limit - elapsed);
      setRemainingSec(left);
      if (left > 0 || timedOutRef.current) return;
      // 每个部分只提示一次，不在考生未作答时自动出下一题。
      timedOutRef.current = true;
      setTimeUp(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, partIndex, itemIndex, currentPart]);

  /** 时间到后由考生主动进入下一部分（或结束整场练习）。 */
  const continueAfterTimeout = () => {
    const next = partIndex + 1 < parts.length ? findNextUnasked(partIndex + 1, 0) : null;
    if (!next) {
      requestFinish();
      return;
    }
    // 进入下一部分前也要满足阻断型语法要求。
    if (hasUnmetBlocking()) {
      setPendingAdvance(true);
      return;
    }
    jumpToPart(next.part, next.item);
  };

  // 自动朗读考官/搭档的新消息（系统 TTS 不可用时静默跳过）。
  useEffect(() => {
    if (!autoRead || phase !== "exam") return;
    const last = messages[messages.length - 1];
    if (last && last.role !== "user") speakGerman(last.text);
  }, [messages, autoRead, phase]);

  const requestReply = async (role: "examiner" | "partner", feedback: SpeakingFeedback) => {
    if (!currentItem || !currentPart) return;
    setBusy(true);
    // 保留整场考试的对话上下文：后端靠 history 判断「已问过什么」，
    // 截断过早会让长期记忆丢失，导致同一问题反复出现。
    // 这里读 ref（已包含刚提交的回答），避免渲染闭包拿到过期消息。
    const history: SpeakingTurn[] = messagesRef.current
      .slice(-MAX_HISTORY_TURNS)
      .map((msg) => ({ role: msg.role, text: msg.text }));
    const reply = await fetchSpeakingReply({
      level,
      examPart: currentPart.key,
      topic: currentItem.topic,
      role,
      history,
      followupCount: replySeq.current,
      promptDE: currentItem.prompt_de,
      expectedPoints: currentItem.expected_points,
      coveredPoints: feedback.covered,
      missingPoints: feedback.missing,
    });
    replySeq.current += 1;
    setBusy(false);
    if (reply.reply) {
      pushMessage(role, reply.reply, undefined, reply.source);
    } else {
      // 后端已内置模板兜底，这里再兜一层，避免对话中断
      pushMessage(role, "Können Sie das noch etwas genauer erklären?", undefined, "template");
    }
  };

  /** 依据后端语法库批改本条回答；不可用时静默跳过。 */
  const checkGrammar = async (msgIDValue: number, text: string) => {
    if (!currentItem) return;
    patchMessage(msgIDValue, { checking: true });
    // 批改要对齐考生实际回答的那句提问，而不是题库原始问句。
    const lastQuestion =
      [...messagesRef.current].reverse().find((msg) => msg.role !== "user")?.text ??
      currentItem.prompt_de;
    const result = await fetchGrammarCheck({
      level,
      topic: currentItem.topic,
      promptDE: lastQuestion,
      answer: text,
    });
    patchMessage(msgIDValue, { checking: false, grammar: result });
  };

  const submit = async () => {
    if (!currentItem || !currentPart || busy || !answer.trim()) return;
    const text = answer.trim();
    // 要点只属于题库原问题：追问的回答不再按原要点判定，避免「答对了却判 0 分」。
    const isFollowup = exchanges > 0;
    const feedback = evaluateAnswer(currentItem, text);
    const stats = statsRef.current;
    stats.turns += 1;
    if (!isFollowup) {
      stats.pointsTotal += feedback.covered.length + feedback.missing.length;
      stats.pointsCovered += feedback.covered.length;
      for (const point of feedback.missing) {
        stats.missing[point] = (stats.missing[point] ?? 0) + 1;
      }
    }
    // 流利度近似指标（文本模式）：响应耗时与重复词比例
    const latency = questionShownAt.current > 0 ? Date.now() - questionShownAt.current : 0;
    if (latency > 0) {
      stats.latencies.push(latency);
    }
    const words = text
      .toLowerCase()
      .replace(/[.,!?;:"'„“”()]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    stats.words += words.length;
    stats.duplicateWords += words.length - new Set(words).size;

    // 逐题汇总：覆盖过的要点不再算遗漏
    const per = stats.perItem[currentItem.item_key] ?? {
      prompt_de: currentItem.prompt_de,
      covered: [],
      missing: [],
      turns: 0,
      latencySum: 0,
    };
    per.turns += 1;
    per.latencySum += latency;
    if (!isFollowup) {
      for (const point of feedback.covered) {
        if (!per.covered.includes(point)) per.covered.push(point);
      }
      for (const point of feedback.missing) {
        if (!per.missing.includes(point)) per.missing.push(point);
      }
      per.missing = per.missing.filter((point) => !per.covered.includes(point));
    }
    stats.perItem[currentItem.item_key] = per;

    const answerMsgID = pushMessage("user", text, isFollowup ? undefined : feedback);
    setAnswer("");
    trackRecentWords(text);
    // 语法要求整场累计；判定失败时放行，避免服务异常导致死锁。
    setBusy(true);
    const allRequirementsMet = await evaluateRequirements(text);
    setBusy(false);
    // 语法检查与追问并行，结果异步回填，不阻塞对话推进。
    void checkGrammar(answerMsgID, text);
    if (feedback.missing.length === 0 && !feedback.tooShort) {
      sfx.correct();
    } else {
      sfx.tap();
    }
    if (!isFollowup && feedback.missing.length > 0) {
      saveSpeakingError({
        item_key: currentItem.item_key,
        level,
        topic: currentItem.topic,
        prompt_de: currentItem.prompt_de,
        missing_points: feedback.missing,
        created_at: new Date().toISOString(),
      });
    }

    const nextExchange = exchanges + 1;
    setExchanges(nextExchange);

    const isDiscussion = currentPart.mode === "discussion";
    const maxExchanges = isDiscussion ? 2 : currentPart.maxFollowups + 1;
    if (nextExchange >= maxExchanges) {
      // 未达成阻断型要求：停在本题，由考生选择「再答一次」或「换一题」。
      if (!allRequirementsMet) {
        setPendingAdvance(true);
        return;
      }
      stats.itemsDone += 1;
      if (!stats.completedKeys.includes(currentItem.item_key)) {
        stats.completedKeys.push(currentItem.item_key);
      }
      advance();
      return;
    }
    // 跑题时把话题拉回，不再发起 LLM 追问。
    if (feedback.offTopic) {
      pushMessage(
        "examiner",
        `Bleiben wir bitte beim Thema: ${currentItem.topic}. ${currentItem.prompt_de}`,
        undefined,
        "template",
      );
      return;
    }
    void requestReply(currentPart.role, feedback);
  };

  const skipItem = () => {
    if (busy) return;
    statsRef.current.itemsDone += 1;
    if (currentItem && !statsRef.current.completedKeys.includes(currentItem.item_key)) {
      statsRef.current.completedKeys.push(currentItem.item_key);
    }
    advance();
  };

  const backToSelect = () => {
    setPhase("select");
    setMessages([]);
    messagesRef.current = [];
    setAnswer("");
    setReport(null);
  };

  const exportReport = () => {
    if (!report) return;
    const blob = new Blob([reportToMarkdown(report)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `speaking-report-${report.level}-${report.id}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // ========== 选择等级 ==========
  if (phase === "select") {
    // 关卡内进入时无需选择等级，等待流程就绪。
    if (initialLevel) {
      return (
        <div className="play-screen">
          <div className="play-topbar">
            <button className="back-btn" onClick={onExit}>
              <ArrowLeftIcon size={18} />
              返回
            </button>
            <span className="level-chip" style={{ background: "#7C5CBF" }}>
              {initialLevel} 口语考试
            </span>
          </div>
          <div className="play-body">
            <p style={{ color: "#8a7d6b" }}>
              {loading ? "正在准备考试…" : error ? `加载失败：${error}` : "正在准备考试…"}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="play-screen">
        <div className="play-topbar">
          <button className="back-btn" onClick={onExit}>
            <ArrowLeftIcon size={18} />
            返回
          </button>
          <span className="level-chip" style={{ background: "#7C5CBF" }}>
            口语模拟 · 三段式
          </span>
        </div>
        <div className="play-body">
          <div style={{ width: "100%", maxWidth: 720 }}>
            <h2 style={{ marginBottom: 6 }}>选择考试等级</h2>
            <p style={{ color: "#8a7d6b", fontSize: 13, marginTop: 0 }}>
              流程：第一部分问答 → 第二部分陈述 → 第三部分双人讨论。
              机器批改仅用于练习辅助，不能替代歌德官方人工口试。
              <br />
              学习记录保存在本机，清除缓存或更换设备会视为新用户。
            </p>

            {dailyWordsEnabled() && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: 14,
                  marginTop: 14,
                  boxShadow: "0 6px 18px rgba(160,125,85,.10)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>今日新词{dailyDate ? ` · ${dailyDate}` : ""}</strong>
                  {dailyWords.length > 0 && (
                    <button
                      className="btn ghost"
                      style={{ fontSize: 12, padding: "3px 10px" }}
                      onClick={markAllDailyWords}
                      disabled={dailyWords.every((word) => markedWords.includes(word.word_id))}
                    >
                      {dailyWords.every((word) => markedWords.includes(word.word_id))
                        ? "已标记学会"
                        : "学会了"}
                    </button>
                  )}
                </div>

                {dailyWords.length > 0 ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                    {dailyWords.map((word) => {
                      const marked = markedWords.includes(word.word_id);
                      return (
                        <div
                          key={word.word_id}
                          style={{
                            background: "#F1F8FF",
                            borderRadius: 8,
                            padding: "8px 10px",
                            minWidth: 170,
                            maxWidth: 260,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <strong style={{ fontSize: 14 }}>
                              {marked ? "✓ " : ""}
                              {word.lemma}
                            </strong>
                            <span style={{ fontSize: 12, color: "#6b6156" }}>{word.chinese_mean}</span>
                          </div>
                          {dailyWordMeta(word) && (
                            <div style={{ fontSize: 12, color: "#8a7d6b", marginTop: 2 }}>
                              {dailyWordMeta(word)}
                            </div>
                          )}
                          {word.example_de && (
                            <div style={{ fontSize: 12, color: "#6b6156", marginTop: 4, fontStyle: "italic" }}>
                              {word.example_de}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  dailyLoaded && (
                    <div style={{ fontSize: 13, color: "#8a7d6b", marginTop: 8 }}>词库准备中，稍后再来看看。</div>
                  )
                )}
              </div>
            )}

            {loading && <p style={{ color: "#8a7d6b" }}>正在加载口语题库…</p>}
            {error && (
              <div style={{ background: "rgba(192,57,43,.12)", color: "#C0392B", padding: 12, borderRadius: 10 }}>
                题库加载失败：{error}
                <button className="btn ghost" style={{ marginLeft: 12 }} onClick={load}>
                  重试
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
              {SPEAKING_LEVELS.map((lv) => {
                const count = items.filter((it) => it.level === lv).length;
                const official = isOfficialExam(lv);
                const ready = official
                  ? examParts.some((part) => part.level === lv) && count > 0
                  : count > 0;
                return (
                  <button
                    key={lv}
                    className="btn ghost"
                    disabled={!ready}
                    onClick={() => setLevel(lv)}
                    style={{
                      background: lv === level ? LEVEL_COLORS[lv] : undefined,
                      color: lv === level ? "#fff" : undefined,
                      opacity: ready ? 1 : 0.4,
                    }}
                  >
                    {official ? `${lv} · 官方流程` : `${lv} · ${count} 题`}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 22 }}>
              <button className="btn primary" disabled={parts.length === 0} onClick={startExam}>
                开始 {level} 模拟
              </button>
            </div>

            {topMissingPoints(5).length > 0 && (
              <div style={{ marginTop: 26 }}>
                <h3 style={{ fontSize: 15, marginBottom: 8 }}>历史高频遗漏要点</h3>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {topMissingPoints(5).map((item) => (
                    <span
                      key={item.point}
                      style={{
                        background: "#FFF1D9",
                        borderRadius: 6,
                        padding: "3px 9px",
                        fontSize: 13,
                      }}
                    >
                      {item.point} × {item.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {recent.length > 0 && (
              <div style={{ marginTop: 26 }}>
                <h3 style={{ fontSize: 15, marginBottom: 8 }}>最近练习</h3>
                {recent.map((session) => {
                  const pct =
                    session.points_total > 0
                      ? Math.round((session.points_covered / session.points_total) * 100)
                      : 0;
                  return (
                    <div
                      key={session.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "#fff",
                        borderRadius: 8,
                        padding: "8px 12px",
                        marginBottom: 8,
                        fontSize: 13,
                      }}
                    >
                      <span>
                        {new Date(session.ended_at).toLocaleString("zh-CN")} · {session.level}
                        {session.points_total > 0 ? ` · 覆盖 ${pct}%` : ""} · {session.turn_count} 轮
                      </span>
                      <button
                        className="btn ghost"
                        style={{ fontSize: 12, padding: "3px 10px" }}
                        onClick={() => {
                          setReport(session);
                          setPhase("report");
                        }}
                      >
                        查看
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ========== 报告 ==========
  if (phase === "report" && report) {
    const coverage =
      report.points_total > 0
        ? Math.round((report.points_covered / report.points_total) * 100)
        : 0;
    return (
      <div className="play-screen">
        <div className="play-topbar">
          <button className="back-btn" onClick={onExit}>
            <ArrowLeftIcon size={18} />
            返回地图
          </button>
          <span className="level-chip" style={{ background: "#7C5CBF" }}>
            练习报告 · {report.level}
          </span>
        </div>
        <div className="play-body">
          <div
            style={{
              width: "100%",
              maxWidth: 620,
              background: "#fff",
              borderRadius: 16,
              padding: 26,
              boxShadow: "0 12px 30px rgba(160,125,85,.14)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              <CheckIcon size={20} /> 本次练习完成
            </h2>
            <p style={{ color: "#6b6156" }}>
              用时 {Math.floor(report.duration_sec / 60)} 分 {report.duration_sec % 60} 秒 · 回答{" "}
              {report.turn_count} 轮 · 完成题目 {report.items_completed}/{report.items_total}
            </p>
            {report.points_total > 0 ? (
              <div style={{ background: "#F7F3FF", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#7C5CBF", marginBottom: 6 }}>要点覆盖率</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{coverage}%</div>
                <div style={{ fontSize: 12, color: "#8a7d6b" }}>
                  覆盖 {report.points_covered} / {report.points_total} 个要点
                </div>
              </div>
            ) : (
              <div style={{ background: "#F7F3FF", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#7C5CBF", marginBottom: 6 }}>考试流程</div>
                <div style={{ fontSize: 14 }}>
                  本场按 {report.level} 官方形式完成 {report.turn_count} 轮作答，
                  内置题卡不统计要点覆盖。
                </div>
              </div>
            )}
            {report.missing_points.length > 0 && (
              <div style={{ background: "#FFF8E1", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#B9770E", marginBottom: 6 }}>高频遗漏要点</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {report.missing_points.map((p) => (
                    <span
                      key={p}
                      style={{ background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 13 }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(report.requirements ?? []).length > 0 && (
              <div style={{ background: "#FFF8E1", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#B9770E", marginBottom: 6 }}>语法要求</div>
                {(report.requirements ?? []).map((item) => (
                  <div key={item.key} style={{ fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: item.met ? "#2E7D32" : "#C0392B" }}>
                      {item.met ? "✓" : "✗"} {item.label}
                    </span>
                    <span style={{ color: "#8a7d6b", marginLeft: 8 }}>
                      {item.achieved}/{item.required}
                      {!item.met && (item.enforce === "block" ? " · 阻断项未达成" : " · 提示项")}
                      {item.evidence.length > 0 && ` · 证据：${item.evidence.join("、")}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {(report.recent_words ?? []).length > 0 && (
              <div style={{ background: "#F1F8FF", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#2F86D6", marginBottom: 6 }}>
                  最近五天新词使用情况
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(report.recent_words ?? []).map((word) => {
                    const used = (report.recent_words_used ?? []).includes(word.lemma);
                    return (
                      <span
                        key={word.lemma}
                        style={{
                          background: used ? "#E3F6E5" : "#fff",
                          color: used ? "#2E7D32" : "#6b6156",
                          borderRadius: 6,
                          padding: "2px 8px",
                          fontSize: 13,
                        }}
                      >
                        {used ? "✓ " : ""}
                        {word.lemma}（{word.chinese_mean}）
                      </span>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, color: "#8a7d6b", marginTop: 6 }}>
                  已使用 {(report.recent_words_used ?? []).length} / {report.recent_words?.length ?? 0} 个
                </div>
              </div>
            )}

            <div style={{ background: "#F4FBF4", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#4FBF58", marginBottom: 6 }}>
                流利度（文本模式近似）
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14 }}>
                <span>平均响应 {(report.avg_response_ms / 1000).toFixed(1)} 秒</span>
                <span>最长响应 {(report.max_response_ms / 1000).toFixed(1)} 秒</span>
                <span>重复词占比 {Math.round(report.repetition_ratio * 100)}%</span>
                <span>估算语速 {report.words_per_min ?? 0} 词/分</span>
              </div>
            </div>

            {(report.items ?? []).length > 0 && (
              <div style={{ background: "#fff", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#6b6156", marginBottom: 8 }}>逐题反馈</div>
                {(report.items ?? []).map((item) => {
                  const total = item.covered.length + item.missing.length;
                  return (
                    <div key={item.item_key} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 14 }}>{item.prompt_de}</div>
                      <div style={{ fontSize: 12, color: "#8a7d6b", marginTop: 2 }}>
                        {total > 0 ? `要点 ${item.covered.length}/${total} · ` : ""}
                        {item.turns} 轮
                        {item.missing.length > 0 && ` · 遗漏：${item.missing.join(" / ")}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p style={{ color: "#6b6156", fontSize: 14 }}>{report.suggested_review}</p>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn primary" onClick={initialLevel ? startExam : backToSelect}>
                再练一次
              </button>
              <button className="btn ghost" onClick={exportReport}>
                导出报告
              </button>
              <button className="btn ghost" onClick={onExit}>
                返回地图
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== 模拟对话 ==========
  return (
    <div className="play-screen">
      <div className="play-topbar">
        <button className="back-btn" onClick={initialLevel ? onExit : backToSelect} disabled={busy}>
          <ArrowLeftIcon size={18} />
          退出
        </button>
        <span className="level-chip" style={{ background: "#7C5CBF" }}>
          {level} · {currentPart ? currentPart.title : "口语考试"}
        </span>
        <span className="quiz-count">
          剩余 {Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, "0")} · 题目{" "}
          {Math.min(itemIndex + 1, currentPart?.items.length ?? 0)} /{" "}
          {currentPart?.items.length ?? 0}
        </span>
        <button
          className="btn ghost"
          style={{ marginLeft: 8, fontSize: 12, padding: "4px 10px" }}
          onClick={() => setAutoRead((v) => !v)}
        >
          🔊 {autoRead ? "自动朗读中" : "自动朗读"}
        </button>
        <button
          className="btn ghost"
          style={{ marginLeft: 8, fontSize: 12, padding: "4px 10px" }}
          onClick={() => setShowSubtitle((v) => !v)}
        >
          {showSubtitle ? "隐藏字幕" : "显示字幕"}
        </button>
      </div>

      <div className="play-body">
        <div style={{ width: "100%", maxWidth: 760 }}>
          {recentWords.length > 0 && (
            <div
              style={{
                background: "#F1F8FF",
                borderRadius: 10,
                padding: "8px 12px",
                marginBottom: 10,
                fontSize: 13,
                color: "#2F86D6",
              }}
            >
              最近五天新词：
              {recentWords.map((word) => `${word.lemma}（${word.chinese_mean}）`).join("、")}
            </div>
          )}

          {requirements.length > 0 && (
            <div
              style={{
                background: "#fff",
                borderRadius: 10,
                padding: "8px 12px",
                marginBottom: 10,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                fontSize: 13,
              }}
            >
              <span style={{ color: "#8a7d6b" }}>语法要求：</span>
              {requirements.map((req) => {
                const color = req.met ? "#2E7D32" : req.enforce === "block" ? "#C0392B" : "#B9770E";
                return (
                  <span
                    key={req.key}
                    title={
                      req.hint_parts.length > 0
                        ? `建议在 ${req.hint_parts.map(partLabel).join("、")} 中尝试`
                        : undefined
                    }
                    style={{
                      color,
                      background: req.met ? "#E3F6E5" : "#FFF3E0",
                      borderRadius: 6,
                      padding: "2px 8px",
                    }}
                  >
                    {req.met ? "✓ " : ""}
                    {req.label} {req.achieved}/{req.required}
                    {!req.met && req.enforce === "block" ? "（未达成）" : ""}
                  </span>
                );
              })}
            </div>
          )}

          {currentPart?.aid && <ExamAidPanel aid={currentPart.aid} />}
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 18,
              boxShadow: "0 12px 30px rgba(160,125,85,.14)",
              maxHeight: "56vh",
              overflowY: "auto",
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    background:
                      msg.role === "user"
                        ? "#E8F0FE"
                        : msg.role === "partner"
                          ? "#F3E8FF"
                          : "#FAF7F0",
                    borderRadius: 12,
                    padding: "10px 14px",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#8a7d6b", marginBottom: 4 }}>
                    {msg.role === "user" ? "你" : msg.role === "partner" ? "搭档" : "考官"}
                    {msg.role !== "user" && msg.source && (
                      <span style={{ marginLeft: 6, color: "#b3a99a" }}>
                        {msg.source === "llm" ? "AI" : "模板"}
                      </span>
                    )}
                    {msg.role !== "user" && (
                      <button
                        onClick={() => speakGerman(msg.text)}
                        style={{
                          marginLeft: 8,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          fontSize: 12,
                          padding: 0,
                        }}
                        title="朗读"
                      >
                        🔊
                      </button>
                    )}
                  </div>
                  {msg.role === "user" || showSubtitle ? (
                    <div style={{ fontSize: 15, lineHeight: 1.6 }}>{msg.text}</div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#a99a86" }}>
                      🔊 语音消息，点击上方「显示字幕」查看内容
                    </div>
                  )}
                  {msg.feedback && (
                    <div style={{ fontSize: 12, color: "#8a7d6b", marginTop: 6 }}>
                      要点覆盖：{msg.feedback.covered.length} /{" "}
                      {msg.feedback.covered.length + msg.feedback.missing.length}
                      {msg.feedback.missing.length > 0 &&
                        ` · 还可补充：${msg.feedback.missing.join(" / ")}`}
                      {msg.feedback.offTopic && (
                        <span style={{ color: "#D9534F", marginLeft: 6 }}>· 可能跑题</span>
                      )}
                    </div>
                  )}
                  {msg.checking && (
                    <div style={{ fontSize: 12, color: "#a99a86", marginTop: 6 }}>语法检查中…</div>
                  )}
                  {msg.grammar && (
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 6,
                        borderTop: "1px dashed #cfd9e8",
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      {msg.grammar.errors.length === 0 ? (
                        <div style={{ color: "#2E7D32" }}>
                          ✓ 语法检查通过
                          {msg.grammar.comment ? `：${msg.grammar.comment}` : ""}
                        </div>
                      ) : (
                        <>
                          <div style={{ color: "#C0392B", marginBottom: 4 }}>
                            语法问题 {msg.grammar.errors.length} 处
                            {msg.grammar.comment ? ` · ${msg.grammar.comment}` : ""}
                          </div>
                          {msg.grammar.errors.map((err, idx) => (
                            <div key={idx} style={{ color: "#6b6156", marginBottom: 3 }}>
                              <span style={{ color: "#C0392B" }}>{err.snippet}</span>
                              <span> → {err.fix}</span>
                              <span style={{ color: "#8a7d6b" }}>
                                （{err.type}：{err.explanation}）
                              </span>
                            </div>
                          ))}
                          {msg.grammar.corrected && (
                            <div style={{ color: "#2F86D6", marginTop: 4 }}>
                              参考改写：{msg.grammar.corrected}
                            </div>
                          )}
                        </>
                      )}
                      {msg.grammar.rules.length > 0 && (
                        <div style={{ color: "#a99a86", marginTop: 4 }}>
                          参考规范：{msg.grammar.rules.join(" / ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div style={{ color: "#a99a86", fontSize: 13, marginBottom: 8 }}>对方正在回应…</div>
            )}
            <div ref={bottomRef} />
          </div>

          {currentItem && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#a99a86" }}>
              当前话题：{currentItem.topic}
              {currentItem.prompt_zh ? ` · ${currentItem.prompt_zh}` : ""}
              {currentItem.error_note ? ` · 提示：${currentItem.error_note}` : ""}
            </div>
          )}

          {timeUp && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 10,
                background: "rgba(192,57,43,.08)",
                color: "#C0392B",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>本部分时间到，考官已停止自动提问。你可以继续作答，或进入下一部分。</span>
              <button
                className="btn ghost"
                style={{ fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
                onClick={continueAfterTimeout}
                disabled={busy}
              >
                {partIndex + 1 < parts.length ? "进入下一部分" : "结束练习"}
              </button>
            </div>
          )}

          {pendingAdvance && !supplementMode && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#FFF3E0",
                color: "#B9770E",
                fontSize: 13,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                语法要求尚未达成：{unmetRequirementLabels().join("、")}。可以再答一次，或换一题继续本场。
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="btn ghost"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={busy}
                  onClick={() => {
                    setPendingAdvance(false);
                    setExchanges(0);
                    if (currentPart) {
                      pushMessage(
                        currentPart.role,
                        "Bitte versuchen Sie es noch einmal mit einer vollständigen Antwort.",
                        undefined,
                        "template",
                      );
                    }
                  }}
                >
                  再答一次
                </button>
                <button
                  className="btn ghost"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={busy}
                  onClick={() => {
                    setPendingAdvance(false);
                    advance();
                  }}
                >
                  换一题
                </button>
              </div>
            </div>
          )}

          {supplementMode ? (
            <div
              style={{
                marginTop: 10,
                padding: 14,
                borderRadius: 12,
                background: "#FFF8E1",
                border: "1px solid #F3D19E",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "#B9770E", marginBottom: 6 }}>
                语法要求补答（{supplementAttempts}/3）
              </div>
              <div style={{ fontSize: 13, color: "#8a7d6b", marginBottom: 8 }}>
                尚未达成：{unmetRequirementLabels().join("、")}。请用一句完整回答展示对应语法结构。
              </div>
              <textarea
                value={supplementText}
                onChange={(event) => setSupplementText(event.target.value)}
                rows={3}
                disabled={busy}
                placeholder="用德语写一句完整的回答…"
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #E0D6C4",
                  padding: 10,
                  fontSize: 14,
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button
                  className="btn primary"
                  onClick={submitSupplement}
                  disabled={busy || !supplementText.trim()}
                >
                  提交补答
                </button>
                {supplementAttempts >= 3 && (
                  <button className="btn ghost" onClick={endWithoutMet} disabled={busy}>
                    结束并记录未达成
                  </button>
                )}
              </div>
              {supplementError && (
                <div style={{ fontSize: 12, color: "#B9770E", marginTop: 8 }}>{supplementError}</div>
              )}
            </div>
          ) : (
            <>
              <VoiceAnswerInput
                value={answer}
                onChange={setAnswer}
                onSubmit={submit}
                disabled={busy}
                rows={3}
                lang={currentItem?.lang ?? "de"}
              />

              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button className="btn primary" onClick={submit} disabled={busy || !answer.trim()}>
                  提交回答
                </button>
                <button className="btn ghost" onClick={skipItem} disabled={busy}>
                  跳过本题
                </button>
                <button className="btn ghost" onClick={requestFinish} disabled={busy}>
                  结束练习
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
