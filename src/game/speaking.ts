// 口语题库：由后端下发，client 端按等级以脚本模式练习。

const API_BASE = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env
  ?.VITE_API_BASE ?? "http://127.0.0.1:8080"

export type SpeakingLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2"

export const SPEAKING_LEVELS: SpeakingLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"]

export interface SpeakingItem {
  item_key: string
  lang: string
  level: SpeakingLevel
  exam_part: string
  topic: string
  role: string
  prompt_de: string
  prompt_zh: string
  expected_points: string
  ref_answer: string
  error_note: string
  sort_order: number
  active: boolean
}

interface SpeakingItemsResponse {
  items: SpeakingItem[]
}

/** 考试辅助材料：关键词、题卡、思维导图、双人日程。 */
export type ExamAid =
  | { kind: "chips"; label: string; items: string[] }
  | { kind: "cards"; label: string; cards: { title: string; hint: string }[] }
  | { kind: "mindmap"; label: string; center: string; branches: string[] }
  | { kind: "schedule"; label: string; groups: { name: string; slots: string[] }[] }
  | { kind: "topic"; label: string; text: string };

/** 部分交互形态：自我介绍 / 问答 / 请求 / 自述 / 规划 / 陈述 / 讨论 */
export type ExamPartMode =
  | "intro"
  | "qa"
  | "request"
  | "monologue"
  | "planning"
  | "presentation"
  | "discussion";

/** 口语考试的固定部分配置，来自 speaking_exam_parts 表。 */
export interface SpeakingExamPart {
  lang: string;
  level: SpeakingLevel;
  part_key: string;
  title: string;
  mode: ExamPartMode;
  duration_sec: number;
  max_followups: number;
  role: "examiner" | "partner";
  aid: ExamAid | null;
  sort_order: number;
}

interface SpeakingExamPartsResponse {
  parts: SpeakingExamPart[];
}

export interface SpeakingFeedback {
  /** 已覆盖的要点 */
  covered: string[]
  /** 未覆盖的要点 */
  missing: string[]
  /** 回答是否明显过短 */
  tooShort: boolean
  /** 是否句首大写 */
  startsUpper: boolean
  /** 是否有句末标点 */
  endsPunct: boolean
  /** 是否与当前话题和要点毫无重合（疑似跑题） */
  offTopic: boolean
}

/** 各部分的建议时长（秒）；到时自动推进到下一部分。 */
export const PART_TIME_LIMIT_SEC: Record<string, number> = {
  part1_intro: 240,
  part2_presentation: 180,
  part3_discussion: 240,
}

const TOPIC_STOPWORDS = new Set([
  "aber", "alle", "auch", "beim", "bitte", "dann", "dass", "dein", "dem", "den",
  "der", "die", "dies", "doch", "dort", "eine", "einen", "einer", "eines", "eure",
  "für", "geht", "gern", "gerne", "habe", "haben", "hast", "ihre", "immer", "kann",
  "kein", "keine", "können", "mich", "mir", "mit", "nach", "nicht", "noch", "oder",
  "ohne", "schon", "sehr", "sein", "sich", "sie", "sind", "über", "und", "unter",
  "viel", "vom", "von", "was", "wenn", "wer", "wie", "wird", "wir", "wohl", "zum",
  "zur",
])

function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-zäöüß]{4,}/g) ?? []
  return new Set(words.filter((w) => !TOPIC_STOPWORDS.has(w)))
}

/** 脚本模式的轻量批改：只做要点覆盖与基本书写规范检查，不作为评分。 */
export function evaluateAnswer(item: SpeakingItem, answer: string): SpeakingFeedback {
  const text = answer.trim()
  const lower = text.toLowerCase()
  const points = parsePoints(item.expected_points)
  const covered = points.filter((p) => pointMatches(p, lower))
  const missing = points.filter((p) => !pointMatches(p, lower))

  const answerWords = contentWords(text)
  const topicWords = contentWords(
    `${item.topic} ${item.prompt_de} ${points.join(" ")}`,
  )
  let overlap = 0
  for (const word of answerWords) {
    if (topicWords.has(word)) overlap += 1
  }
  const offTopic = answerWords.size >= 4 && overlap === 0

  return {
    covered,
    missing,
    tooShort: text.length < 8,
    startsUpper: !!text && text[0] === text[0].toUpperCase(),
    endsPunct: /[.!?]$/.test(text),
    offTopic,
  }
}

/** 用系统语音朗读德语；不支持时静默降级。 */
export function speakGerman(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = "de-DE"
    utterance.rate = 0.95
    window.speechSynthesis.speak(utterance)
  } catch {
    // 忽略：TTS 不可用不影响练习
  }
}

const PART_LABELS: Record<string, string> = {
  part1_intro: "第一部分 · 自我介绍与问答",
  part2_presentation: "第二部分 · 主题陈述",
  part3_discussion: "第三部分 · 双人讨论",
}

export function partLabel(part: string): string {
  return PART_LABELS[part] ?? part
}

/** 解析 expected_points JSON；格式异常时返回空数组而不是抛错。 */
export function parsePoints(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

/** 单个要点内可用 `|` 表示同义表达，命中任意一个即算覆盖。 */
function pointMatches(point: string, lowerAnswer: string): boolean {
  return point
    .split("|")
    .map((alt) => alt.trim().toLowerCase())
    .some((alt) => alt !== "" && lowerAnswer.includes(alt))
}

export function fetchSpeakingItems(params?: {
  lang?: string
  level?: string
}): Promise<SpeakingItem[]> {
  const query = new URLSearchParams()
  query.set("lang", params?.lang ?? "de")
  if (params?.level) query.set("level", params.level)
  return fetch(`${API_BASE}/api/speaking/items?${query.toString()}`, {
    headers: { Accept: "application/json" },
  }).then(async (res) => {
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const body = await res.json()
        if (body?.error) msg = body.error
      } catch {
        // ignore
      }
      throw new Error(msg)
    }
    const body = (await res.json()) as SpeakingItemsResponse
    return body.items ?? []
  })
}

/** 拉取口语考试各部分配置（A1/A2 的考试结构来源）。 */
export function fetchSpeakingExamParts(params?: {
  lang?: string;
  level?: string;
}): Promise<SpeakingExamPart[]> {
  const query = new URLSearchParams();
  query.set("lang", params?.lang ?? "de");
  if (params?.level) query.set("level", params.level);
  return fetch(`${API_BASE}/api/speaking/exam-parts?${query.toString()}`, {
    headers: { Accept: "application/json" },
  }).then(async (res) => {
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const body = (await res.json()) as SpeakingExamPartsResponse;
    return body.parts ?? [];
  });
}

/** 方案级语法要求；整场任意回答达成即可，hint_parts 仅用于界面提示。 */
export interface GrammarRequirement {
  key: string;
  label: string;
  source_path: string;
  patterns: string[];
  min_uses: number;
  enforce: "block" | "warn";
  hint_parts: string[];
  /** 语法点引导问句，由方案详情接口附加，用于定向补答 */
  prompts?: string[];
}

/** 最近五天学过的新词。 */
export interface RecentWord {
  lemma: string;
  chinese_mean: string;
  level: string;
}

/** 口语方案：关卡里选择的口语入口，决定本场考试抽取哪些题目。 */
export interface SpeakingPlan {
  id: number;
  lang: string;
  level: string;
  name: string;
  description: string;
  active: boolean;
  item_count: number;
  grammar_requirements?: GrammarRequirement[];
}

export interface SpeakingPlanDetail {
  plan: SpeakingPlan;
  items: SpeakingItem[];
  recent_words?: RecentWord[];
}

/** 拉取口语方案及其题目；带 device_id 时附带最近五天新词。 */
export function fetchSpeakingPlan(
  id: string | number,
  deviceId?: string,
): Promise<SpeakingPlanDetail> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  return fetch(`${API_BASE}/api/speaking/plans/${id}${query}`, {
    headers: { Accept: "application/json" },
  }).then(async (res) => {
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    return (await res.json()) as SpeakingPlanDetail;
  });
}

// ---------------------------------------------------------------------------
// 设备标识：学习记录保存在本机，清缓存/换设备视为新用户
// ---------------------------------------------------------------------------

const DEVICE_KEY = "device.id.v1";

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// 每日新词（需要服务端 X-API-Key；未配置时不请求，页面保持隐藏）
// ---------------------------------------------------------------------------

const DAILY_WORDS_KEY = (import.meta as unknown as { env?: { VITE_DAILY_WORDS_API_KEY?: string } })
  .env?.VITE_DAILY_WORDS_API_KEY;

export interface DailyWord {
  word_id: number;
  lemma: string;
  word_type?: string;
  gender?: string;
  plural?: string;
  chinese_mean: string;
  english_mean?: string;
  example_de?: string;
}

export interface DailyWordsResult {
  date: string;
  lang: string;
  level: string;
  words: DailyWord[];
  reason?: string;
}

export function dailyWordsEnabled(): boolean {
  return !!DAILY_WORDS_KEY;
}

/** 拉取当天新词；未配置 API Key 或请求失败时返回空列表，页面不报错。 */
export async function fetchDailyWords(
  deviceId: string,
  level?: string,
): Promise<DailyWordsResult> {
  if (!DAILY_WORDS_KEY) {
    return { date: "", lang: "de", level: level ?? "", words: [] };
  }
  const query = new URLSearchParams({ lang: "de", count: "5" });
  if (level) query.set("level", level);
  if (deviceId) query.set("device_id", deviceId);
  try {
    const res = await fetch(`${API_BASE}/api/daily-words?${query.toString()}`, {
      headers: { Accept: "application/json", "X-API-Key": DAILY_WORDS_KEY },
    });
    if (!res.ok) return { date: "", lang: "de", level: level ?? "", words: [] };
    return (await res.json()) as DailyWordsResult;
  } catch {
    return { date: "", lang: "de", level: level ?? "", words: [] };
  }
}

/** 标记今日新词已学会；失败静默，不影响练习。 */
export async function markDailyWordsLearned(deviceId: string, wordIds: number[]): Promise<boolean> {
  if (!DAILY_WORDS_KEY || !deviceId || wordIds.length === 0) return false;
  try {
    const res = await fetch(`${API_BASE}/api/daily-words/learned`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": DAILY_WORDS_KEY,
      },
      body: JSON.stringify({ device_id: deviceId, word_ids: wordIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 语法要求达成判定（服务端无状态，客户端累计 already_met）
// ---------------------------------------------------------------------------

export interface RequirementCheckResult {
  key: string;
  matched: boolean;
  count: number;
  evidence: string[];
}

export interface RequirementCheckResponse {
  results: RequirementCheckResult[];
  all_blocking_met: boolean;
  missing: string[];
}

export async function checkGrammarRequirements(params: {
  planId: number;
  level: string;
  answer: string;
  alreadyMet: string[];
}): Promise<RequirementCheckResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/speaking/requirements/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        plan_id: params.planId,
        level: params.level,
        answer: params.answer,
        already_met: params.alreadyMet,
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as RequirementCheckResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 本地练习记录（仅存本地，不上传）
// ---------------------------------------------------------------------------

const STORAGE_KEY = "speaking.progress.v1"

export interface SpeakingProgress {
  /** 已完成练习的 item_key 集合 */
  completed: string[]
}

export function loadSpeakingProgress(): SpeakingProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { completed: [] }
    const parsed = JSON.parse(raw) as Partial<SpeakingProgress>
    return { completed: Array.isArray(parsed.completed) ? parsed.completed : [] }
  } catch {
    return { completed: [] }
  }
}

export function saveSpeakingProgress(progress: SpeakingProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // 本地存储不可用时忽略
  }
}

// ---------------------------------------------------------------------------
// 受控追问 / 搭档回应（后端优先 LLM，异常回退模板）
// ---------------------------------------------------------------------------

export interface SpeakingTurn {
  role: "user" | "examiner" | "partner"
  text: string
}

export interface SpeakingReplyParams {
  level: string
  examPart: string
  topic: string
  role: "examiner" | "partner"
  history: SpeakingTurn[]
  followupCount: number
  promptDE: string
  /** 本题要点与当前覆盖情况，用于把追问约束在本题内 */
  expectedPoints?: string
  coveredPoints?: string[]
  missingPoints?: string[]
}

export interface SpeakingReplyResult {
  reply: string
  source: "llm" | "template"
}

export interface GrammarIssue {
  /** 错误类型：冠词 / 格 / 介词 / 语序 / 动词变位 / 搭配 */
  type: string
  /** 原句中的错误片段 */
  snippet: string
  /** 正确写法 */
  fix: string
  /** 中文解释 */
  explanation: string
}

export interface GrammarCheck {
  corrected: string
  errors: GrammarIssue[]
  rules: string[]
  comment: string
  source: "llm" | "template"
}

export interface GrammarCheckParams {
  level: string
  topic: string
  promptDE: string
  answer: string
}

/** 依据服务端语法库批改回答；不可用或未启用 LLM 时返回 null，前端静默降级。 */
export async function fetchGrammarCheck(
  params: GrammarCheckParams,
): Promise<GrammarCheck | null> {
  try {
    const res = await fetch(`${API_BASE}/api/speaking/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        lang: "de",
        level: params.level,
        topic: params.topic,
        prompt_de: params.promptDE,
        answer: params.answer,
      }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as Partial<GrammarCheck>
    if (body.source !== "llm") return null
    return {
      corrected: body.corrected ?? "",
      errors: Array.isArray(body.errors) ? body.errors : [],
      rules: Array.isArray(body.rules) ? body.rules : [],
      comment: body.comment ?? "",
      source: "llm",
    }
  } catch {
    return null
  }
}

/** 请求下一句考官追问或搭档回应；失败时返回空串由调用方兜底。 */
export async function fetchSpeakingReply(
  params: SpeakingReplyParams,
): Promise<SpeakingReplyResult> {
  try {
    const res = await fetch(`${API_BASE}/api/speaking/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        lang: "de",
        level: params.level,
        exam_part: params.examPart,
        topic: params.topic,
        role: params.role,
        history: params.history,
        followup_count: params.followupCount,
        prompt_de: params.promptDE,
        expected_points: params.expectedPoints ?? "",
        covered_points: params.coveredPoints ?? [],
        missing_points: params.missingPoints ?? [],
      }),
    })
    if (!res.ok) return { reply: "", source: "template" }
    const body = (await res.json()) as { reply?: string; source?: string }
    return {
      reply: (body.reply ?? "").trim(),
      source: body.source === "llm" ? "llm" : "template",
    }
  } catch {
    return { reply: "", source: "template" }
  }
}

// ---------------------------------------------------------------------------
// 语音输入：录音上传后端转写
// ---------------------------------------------------------------------------

/** 上传一段录音并转写为文本；lang 指定音频语种，避免被识别成其他语言。 */
export async function transcribeSpeakingAudio(audio: Blob, lang = "de"): Promise<string> {
  const form = new FormData()
  form.append("audio", audio, "answer.wav")
  form.append("lang", lang)
  const res = await fetch(`${API_BASE}/api/speaking/transcribe`, {
    method: "POST",
    body: form,
    headers: { Accept: "application/json" },
  })
  if (!res.ok) {
    let detail = ""
    try {
      const body = (await res.json()) as { error?: string }
      detail = body.error ?? ""
    } catch {
      /* 非 JSON 响应 */
    }
    if (res.status === 503) {
      throw new Error("语音识别未启用，请先在服务端配置 ASR")
    }
    throw new Error(detail || `语音识别失败（HTTP ${res.status}）`)
  }
  const body = (await res.json()) as { text?: string }
  return (body.text ?? "").trim()
}

// ---------------------------------------------------------------------------
// 会话报告（仅存本地，不上传）
// ---------------------------------------------------------------------------

const SESSION_KEY = "speaking.sessions.v1"

export interface SpeakingItemResult {
  item_key: string
  prompt_de: string
  covered: string[]
  missing: string[]
  turns: number
  avg_response_ms: number
}

/** 报告中的单条语法要求结果。 */
export interface RequirementResult {
  key: string
  label: string
  source_path?: string
  enforce: "block" | "warn"
  required: number
  achieved: number
  met: boolean
  evidence: string[]
  attempts: number
}

export interface SpeakingSessionReport {
  id: string
  level: string
  started_at: string
  ended_at: string
  duration_sec: number
  parts: string[]
  turn_count: number
  items_total: number
  items_completed: number
  points_total: number
  points_covered: number
  missing_points: string[]
  suggested_review: string
  /** 流利度：平均/最长响应耗时（毫秒）、重复词占比与估算语速（词/分钟） */
  avg_response_ms: number
  max_response_ms: number
  repetition_ratio: number
  words_per_min: number
  /** 逐题反馈 */
  items: SpeakingItemResult[]
  /** 方案级语法要求达成情况 */
  requirements?: RequirementResult[]
  /** 开考时提示的最近五天新词 */
  recent_words?: RecentWord[]
  /** 回答中实际使用到的新词 */
  recent_words_used?: string[]
}

export function loadSpeakingSessions(): SpeakingSessionReport[] {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SpeakingSessionReport[]) : []
  } catch {
    return []
  }
}

export function saveSpeakingSession(report: SpeakingSessionReport): void {
  try {
    const list = [report, ...loadSpeakingSessions()].slice(0, 20)
    localStorage.setItem(SESSION_KEY, JSON.stringify(list))
  } catch {
    // 本地存储不可用时忽略
  }
}

// ---------------------------------------------------------------------------
// 错题沉淀：记录反复遗漏的要点，供下次练习前复习
// ---------------------------------------------------------------------------

const ERROR_KEY = "speaking.errors.v1"

export interface SpeakingErrorEntry {
  item_key: string
  level: string
  topic: string
  prompt_de: string
  missing_points: string[]
  created_at: string
}

export function loadSpeakingErrors(): SpeakingErrorEntry[] {
  try {
    const raw = localStorage.getItem(ERROR_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SpeakingErrorEntry[]) : []
  } catch {
    return []
  }
}

/** 追加一条错题记录（同题覆盖旧记录），最多保留 100 条。 */
export function saveSpeakingError(entry: SpeakingErrorEntry): void {
  try {
    const list = [entry, ...loadSpeakingErrors().filter((e) => e.item_key !== entry.item_key)]
    localStorage.setItem(ERROR_KEY, JSON.stringify(list.slice(0, 100)))
  } catch {
    // 本地存储不可用时忽略
  }
}

/** 汇总历史遗漏要点，按出现次数从高到低返回。 */
export function topMissingPoints(limit = 5): { point: string; count: number }[] {
  const counter = new Map<string, number>()
  for (const entry of loadSpeakingErrors()) {
    for (const point of entry.missing_points) {
      counter.set(point, (counter.get(point) ?? 0) + 1)
    }
  }
  return [...counter.entries()]
    .map(([point, count]) => ({ point, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// 报告导出（Markdown）
// ---------------------------------------------------------------------------

export function reportToMarkdown(report: SpeakingSessionReport): string {
  const coverage =
    report.points_total > 0
      ? Math.round((report.points_covered / report.points_total) * 100)
      : 0;
  const lines = [
    `# 口语练习报告（${report.level}）`,
    "",
    `- 开始时间：${new Date(report.started_at).toLocaleString("zh-CN")}`,
    `- 结束时间：${new Date(report.ended_at).toLocaleString("zh-CN")}`,
    `- 练习时长：${report.duration_sec} 秒`,
    `- 回答轮次：${report.turn_count}`,
    `- 完成题目：${report.items_completed}/${report.items_total}`,
    `- 要点覆盖率：${coverage}%（${report.points_covered}/${report.points_total}）`,
    `- 平均响应耗时：${(report.avg_response_ms / 1000).toFixed(1)} 秒`,
    `- 最长响应耗时：${(report.max_response_ms / 1000).toFixed(1)} 秒`,
    `- 重复词占比：${Math.round(report.repetition_ratio * 100)}%`,
    `- 估算语速：${report.words_per_min ?? 0} 词/分钟`,
    "",
  ];
  const itemResults = report.items ?? [];
  if (itemResults.length > 0) {
    lines.push("## 逐题反馈", "");
    for (const item of itemResults) {
      const covered = item.covered.length;
      const total = covered + item.missing.length;
      lines.push(`### ${item.prompt_de}`);
      lines.push("");
      lines.push(`- 要点覆盖：${covered}/${total}`);
      if (item.missing.length > 0) {
        lines.push(`- 遗漏：${item.missing.join(" / ")}`);
      }
      lines.push(`- 回答轮次：${item.turns}`);
      lines.push("");
    }
  }
  if (report.missing_points.length > 0) {
    lines.push("## 高频遗漏要点", "", ...report.missing_points.map((p) => `- ${p}`), "");
  }
  const requirements = report.requirements ?? [];
  if (requirements.length > 0) {
    lines.push("## 语法要求", "");
    for (const item of requirements) {
      const status = item.met ? "已达成" : item.enforce === "block" ? "未达成（阻断）" : "未达成（提示）";
      lines.push(`- ${item.label}：${status}，${item.achieved}/${item.required}`);
      if (item.evidence.length > 0) {
        lines.push(`  - 证据：${item.evidence.join("、")}`);
      }
    }
    lines.push("");
  }
  if ((report.recent_words ?? []).length > 0) {
    const used = report.recent_words_used ?? [];
    lines.push("## 最近五天新词", "");
    for (const word of report.recent_words ?? []) {
      lines.push(`- ${word.lemma}（${word.chinese_mean}）${used.includes(word.lemma) ? " ✓ 已使用" : ""}`);
    }
    lines.push("");
  }
  lines.push("## 建议", "", report.suggested_review, "");
  lines.push("> 机器批改仅用于练习辅助，不能替代歌德官方人工口试。");
  return lines.join("\n");
}
