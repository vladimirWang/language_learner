import { useEffect, useMemo, useRef, useState } from "react";
import {
  PART_TIME_LIMIT_SEC,
  SPEAKING_LEVELS,
  evaluateAnswer,
  fetchSpeakingItems,
  fetchSpeakingReply,
  loadSpeakingProgress,
  reportToMarkdown,
  saveSpeakingError,
  saveSpeakingProgress,
  saveSpeakingSession,
  speakGerman,
  partLabel,
  topMissingPoints,
  type SpeakingFeedback,
  type SpeakingItem,
  type SpeakingLevel,
  type SpeakingSessionReport,
  type SpeakingTurn,
} from "../game/speaking";
import { sfx } from "../game/audio";
import { ArrowLeftIcon, CheckIcon } from "./icons";

type Props = {
  onExit: () => void;
};

type Phase = "select" | "exam" | "report";

interface PartGroup {
  key: string;
  items: SpeakingItem[];
}

interface ChatMessage {
  id: number;
  role: "user" | "examiner" | "partner";
  text: string;
  feedback?: SpeakingFeedback;
  /** 非用户消息的来源：LLM 生成或模板兜底 */
  source?: "llm" | "template";
}

const PART_ORDER = ["part1_intro", "part2_presentation", "part3_discussion"];
const MAX_FOLLOWUPS = 2;

const LEVEL_COLORS: Record<SpeakingLevel, string> = {
  A1: "#4FBF58",
  A2: "#2F86D6",
  B1: "#FF8A3D",
  B2: "#F2588E",
  C1: "#8E44AD",
  C2: "#6C3483",
};

function initialRole(item: SpeakingItem): "examiner" | "partner" {
  return item.exam_part === "part3_discussion" && item.role === "partner" ? "partner" : "examiner";
}

export default function SpeakingExamView({ onExit }: Props) {
  const [phase, setPhase] = useState<Phase>("select");
  const [level, setLevel] = useState<SpeakingLevel>("A1");
  const [items, setItems] = useState<SpeakingItem[]>([]);
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
  });
  const msgID = useRef(0);
  const replySeq = useRef(0);
  const questionShownAt = useRef(0);
  const partStartedAt = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const [autoRead, setAutoRead] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchSpeakingItems({ lang: "de" })
      .then((list) => {
        setItems(list);
        const first = SPEAKING_LEVELS.find((lv) => list.some((it) => it.level === lv));
        if (first) setLevel(first);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const parts = useMemo<PartGroup[]>(
    () =>
      PART_ORDER.map((key) => ({
        key,
        items: items.filter((it) => it.level === level && it.exam_part === key),
      })).filter((part) => part.items.length > 0),
    [items, level],
  );

  const currentPart = parts[partIndex] ?? null;
  const currentItem = currentPart?.items[itemIndex] ?? null;
  const totalItems = parts.reduce((sum, part) => sum + part.items.length, 0);

  const pushMessage = (
    role: ChatMessage["role"],
    text: string,
    feedback?: SpeakingFeedback,
    source?: ChatMessage["source"],
  ) => {
    msgID.current += 1;
    const msg: ChatMessage = { id: msgID.current, role, text, feedback, source };
    setMessages((prev) => [...prev, msg]);
    if (role !== "user") {
      questionShownAt.current = Date.now();
    }
  };

  const startExam = () => {
    if (parts.length === 0) return;
    startedAtRef.current = Date.now();
    replySeq.current = 0;
    partStartedAt.current = Date.now();
    setRemainingSec(PART_TIME_LIMIT_SEC[parts[0].key] ?? 240);
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
    };
    setMessages([]);
    setAnswer("");
    setPartIndex(0);
    setItemIndex(0);
    setExchanges(0);
    setReport(null);
    setPhase("exam");
    pushMessage(initialRole(parts[0].items[0]), parts[0].items[0].prompt_de);
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
    };
    saveSpeakingSession(result);
    const boosted = Array.from(
      new Set([...loadSpeakingProgress().completed, ...stats.completedKeys]),
    );
    saveSpeakingProgress({ completed: boosted });
    setReport(result);
    setPhase("report");
    sfx.win();
  };

  const advance = () => {
    if (!currentPart) return;
    if (itemIndex + 1 < currentPart.items.length) {
      const next = currentPart.items[itemIndex + 1];
      setItemIndex(itemIndex + 1);
      setExchanges(0);
      pushMessage(initialRole(next), next.prompt_de);
      return;
    }
    if (partIndex + 1 < parts.length) {
      const nextPart = parts[partIndex + 1];
      setPartIndex(partIndex + 1);
      setItemIndex(0);
      setExchanges(0);
      partStartedAt.current = Date.now();
      setRemainingSec(PART_TIME_LIMIT_SEC[nextPart.key] ?? 240);
      pushMessage(initialRole(nextPart.items[0]), nextPart.items[0].prompt_de);
      return;
    }
    finishExam();
  };

  // 部分计时：到时自动推进到下一部分，最后一部分结束则出报告。
  useEffect(() => {
    if (phase !== "exam" || !currentPart) return;
    const limit = PART_TIME_LIMIT_SEC[currentPart.key] ?? 240;
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - partStartedAt.current) / 1000);
      const left = Math.max(0, limit - elapsed);
      setRemainingSec(left);
      if (left <= 0) advance();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, partIndex, itemIndex, currentPart]);

  // 自动朗读考官/搭档的新消息（系统 TTS 不可用时静默跳过）。
  useEffect(() => {
    if (!autoRead || phase !== "exam") return;
    const last = messages[messages.length - 1];
    if (last && last.role !== "user") speakGerman(last.text);
  }, [messages, autoRead, phase]);

  const requestReply = async (role: "examiner" | "partner", latestAnswer: string) => {
    if (!currentItem || !currentPart) return;
    setBusy(true);
    const history: SpeakingTurn[] = [
      ...messages.slice(-8).map((msg) => ({ role: msg.role, text: msg.text })),
      { role: "user" as const, text: latestAnswer },
    ];
    const reply = await fetchSpeakingReply({
      level,
      examPart: currentPart.key,
      topic: currentItem.topic,
      role,
      history,
      followupCount: replySeq.current,
      promptDE: currentItem.prompt_de,
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

  const submit = () => {
    if (!currentItem || !currentPart || busy || !answer.trim()) return;
    const text = answer.trim();
    const feedback = evaluateAnswer(currentItem, text);
    const stats = statsRef.current;
    stats.turns += 1;
    stats.pointsTotal += feedback.covered.length + feedback.missing.length;
    stats.pointsCovered += feedback.covered.length;
    for (const point of feedback.missing) {
      stats.missing[point] = (stats.missing[point] ?? 0) + 1;
    }
    // 流利度近似指标（文本模式）：响应耗时与重复词比例
    if (questionShownAt.current > 0) {
      stats.latencies.push(Date.now() - questionShownAt.current);
    }
    const words = text
      .toLowerCase()
      .replace(/[.,!?;:"'„“”()]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    stats.words += words.length;
    stats.duplicateWords += words.length - new Set(words).size;

    pushMessage("user", text, feedback);
    setAnswer("");
    if (feedback.missing.length === 0 && !feedback.tooShort) {
      sfx.correct();
    } else {
      sfx.tap();
    }
    if (feedback.missing.length > 0) {
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

    const isDiscussion = currentPart.key === "part3_discussion";
    const maxExchanges = isDiscussion ? 2 : MAX_FOLLOWUPS + 1;
    if (nextExchange >= maxExchanges) {
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
    void requestReply(isDiscussion ? "partner" : "examiner", text);
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
            </p>

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
                return (
                  <button
                    key={lv}
                    className="btn ghost"
                    disabled={count === 0}
                    onClick={() => setLevel(lv)}
                    style={{
                      background: lv === level ? LEVEL_COLORS[lv] : undefined,
                      color: lv === level ? "#fff" : undefined,
                      opacity: count === 0 ? 0.4 : 1,
                    }}
                  >
                    {lv} · {count} 题
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
            <div style={{ background: "#F7F3FF", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#7C5CBF", marginBottom: 6 }}>要点覆盖率</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{coverage}%</div>
              <div style={{ fontSize: 12, color: "#8a7d6b" }}>
                覆盖 {report.points_covered} / {report.points_total} 个要点
              </div>
            </div>
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
            <div style={{ background: "#F4FBF4", borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#4FBF58", marginBottom: 6 }}>
                流利度（文本模式近似）
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 14 }}>
                <span>平均响应 {(report.avg_response_ms / 1000).toFixed(1)} 秒</span>
                <span>最长响应 {(report.max_response_ms / 1000).toFixed(1)} 秒</span>
                <span>重复词占比 {Math.round(report.repetition_ratio * 100)}%</span>
              </div>
            </div>
            <p style={{ color: "#6b6156", fontSize: 14 }}>{report.suggested_review}</p>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="btn primary" onClick={backToSelect}>
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
        <button className="back-btn" onClick={backToSelect} disabled={busy}>
          <ArrowLeftIcon size={18} />
          退出
        </button>
        <span className="level-chip" style={{ background: "#7C5CBF" }}>
          {level} · {currentPart ? partLabel(currentPart.key) : "口语模拟"}
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

          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="用德语输入你的回答，回车提交，Shift+回车换行…"
            disabled={busy}
            rows={3}
            style={{
              width: "100%",
              marginTop: 10,
              padding: 12,
              borderRadius: 10,
              border: "1px solid #e6dccb",
              fontFamily: "inherit",
              fontSize: 15,
              resize: "vertical",
              background: busy ? "#FAF7F0" : "#fff",
            }}
          />

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button className="btn primary" onClick={submit} disabled={busy || !answer.trim()}>
              提交回答
            </button>
            <button className="btn ghost" onClick={skipItem} disabled={busy}>
              跳过本题
            </button>
            <button className="btn ghost" onClick={finishExam} disabled={busy}>
              结束练习
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
