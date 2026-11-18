import { useEffect, useState } from "react";
import {
  evaluateAnswer,
  fetchGrammarCheck,
  fetchTopicPlan,
  speakGerman,
  type GrammarCheck,
  type SpeakingFeedback,
  type SpeakingItem,
  type TopicPlanRound,
} from "../game/speaking";
import { sfx } from "../game/audio";
import { ArrowLeftIcon, CheckIcon, SpeakerIcon } from "./icons";

type Props = {
  level: string;
  topic: string;
  title?: string;
  onExit: () => void;
  onComplete: () => void;
};

interface RoundFeedback {
  coverage: SpeakingFeedback | null;
  grammar: GrammarCheck | null;
}

/** 把一轮主题提问映射成可复用的题库结构，用于要点覆盖判定。 */
function roundToItem(round: TopicPlanRound, level: string, topic: string, index: number): SpeakingItem {
  return {
    item_key: round.item_key ?? `topic-${index}`,
    lang: "de",
    level: level as SpeakingItem["level"],
    exam_part: "part1_intro",
    topic,
    role: "examiner",
    prompt_de: round.question_de,
    prompt_zh: round.question_zh ?? "",
    expected_points: JSON.stringify(round.expected_points ?? []),
    ref_answer: round.ref_answer ?? "",
    error_note: "",
    sort_order: index,
    active: true,
  };
}

/**
 * 主题对话：由服务端把话题下的细粒度语料编排成至少 5 轮，
 * 这里按轮次依次提问、批改语法并统计要点覆盖。
 */
export default function TopicSpeakingView({ level, topic, title, onExit, onComplete }: Props) {
  const [rounds, setRounds] = useState<TopicPlanRound[]>([]);
  const [source, setSource] = useState<"llm" | "template">("template");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<RoundFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchTopicPlan({ level, topic })
      .then((plan) => {
        setRounds(plan.rounds);
        setSource(plan.source);
        if (plan.rounds.length === 0) {
          setError("该主题暂无可练习的语料。");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [level, topic]);

  const current = rounds[index] ?? null;

  useEffect(() => {
    if (current) speakGerman(current.question_de);
  }, [current]);

  const submit = async () => {
    if (!current || !answer.trim() || busy) return;
    setBusy(true);
    const item = roundToItem(current, level, topic, index);
    const hasPoints = (current.expected_points ?? []).length > 0;
    const coverage = hasPoints ? evaluateAnswer(item, answer) : null;
    if (coverage && coverage.missing.length === 0 && !coverage.tooShort) {
      sfx.correct();
    } else {
      sfx.tap();
    }
    const grammar = await fetchGrammarCheck({
      level,
      topic,
      promptDE: current.question_de,
      answer: answer.trim(),
    });
    setFeedback({ coverage, grammar });
    setBusy(false);
  };

  const next = () => {
    setFeedback(null);
    setAnswer("");
    if (index + 1 < rounds.length) {
      setIndex(index + 1);
      return;
    }
    setFinished(true);
    sfx.win();
  };

  return (
    <div className="play-screen">
      <div className="play-topbar">
        <button className="back-btn" onClick={onExit}>
          <ArrowLeftIcon size={18} />
          返回
        </button>
        <span className="level-chip" style={{ background: "#7C5CBF" }}>
          {title ? `${title} · ${topic}` : `主题对话 · ${topic}`}
        </span>
        <span className="quiz-count">
          {loading ? "准备中…" : `第 ${Math.min(index + 1, rounds.length)} / ${rounds.length} 轮`}
        </span>
      </div>

      <div className="play-body">
        <div style={{ width: "100%", maxWidth: 760 }}>
          <p style={{ color: "#8a7d6b", fontSize: 13, marginTop: 0 }}>
            主题对话由服务端编排，至少 5 轮；机器批改仅用于练习辅助。
          </p>

          {loading && <p style={{ color: "#8a7d6b" }}>正在编排主题对话…</p>}

          {error && (
            <div
              style={{
                background: "rgba(192,57,43,.12)",
                color: "#C0392B",
                padding: 12,
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              {error}
              <button className="btn ghost" style={{ marginLeft: 12 }} onClick={load}>
                重试
              </button>
            </div>
          )}

          {!loading && !error && finished && (
            <div
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: 28,
                textAlign: "center",
                boxShadow: "0 12px 30px rgba(160,125,85,.14)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>
                <CheckIcon size={20} /> 主题对话完成
              </h2>
              <p style={{ color: "#6b6156" }}>
                已完成「{topic}」全部 {rounds.length} 轮对话。
              </p>
              <button className="btn primary" style={{ marginTop: 12 }} onClick={onComplete}>
                返回关卡
              </button>
            </div>
          )}

          {!loading && !error && !finished && current && (
            <div
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: 24,
                boxShadow: "0 12px 30px rgba(160,125,85,.14)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "#8a7d6b", fontSize: 13 }}>
                  第 {index + 1} 轮 · {current.kind === "anchor" ? "素材题" : "衔接追问"}
                </span>
                <span style={{ color: "#a99a86", fontSize: 12 }}>
                  脚本来源：{source === "llm" ? "LLM 编排" : "模板兜底"}
                </span>
              </div>

              <h2 style={{ margin: "14px 0 6px", fontSize: 24, display: "flex", gap: 8 }}>
                <span>{current.question_de}</span>
                <button
                  className="btn ghost"
                  style={{ padding: "2px 8px" }}
                  title="重新朗读"
                  onClick={() => speakGerman(current.question_de)}
                >
                  <SpeakerIcon size={16} />
                </button>
              </h2>
              {current.question_zh && (
                <p style={{ color: "#8a7d6b", marginTop: 0 }}>{current.question_zh}</p>
              )}

              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="用德语输入你的回答…"
                disabled={!!feedback}
                rows={4}
                style={{
                  width: "100%",
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #e6dccb",
                  fontFamily: "inherit",
                  fontSize: 15,
                  resize: "vertical",
                  background: feedback ? "#FAF7F0" : "#fff",
                }}
              />

              {!feedback && (
                <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                  <button
                    className="btn primary"
                    onClick={() => void submit()}
                    disabled={!answer.trim() || busy}
                  >
                    {busy ? "批改中…" : "提交回答"}
                  </button>
                </div>
              )}

              {feedback && (
                <div style={{ marginTop: 16 }}>
                  {feedback.coverage && (
                    <div
                      style={{
                        background: "#F4FBF4",
                        borderRadius: 10,
                        padding: 14,
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ fontSize: 13, color: "#6b6156", marginBottom: 6 }}>
                        要点覆盖：{feedback.coverage.covered.length} /{" "}
                        {feedback.coverage.covered.length + feedback.coverage.missing.length}
                      </div>
                      {feedback.coverage.missing.length > 0 ? (
                        <div style={{ fontSize: 14 }}>
                          还可补充：
                          {feedback.coverage.missing.map((p) => (
                            <span
                              key={p}
                              style={{
                                background: "#FFF1D9",
                                borderRadius: 6,
                                padding: "2px 8px",
                                marginRight: 6,
                                display: "inline-block",
                                marginTop: 4,
                              }}
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, color: "#4FBF58" }}>要点都已覆盖，很棒！</div>
                      )}
                      {feedback.coverage.tooShort && (
                        <div style={{ fontSize: 13, color: "#C0392B", marginTop: 8 }}>
                          回答偏短，建议补充完整句子。
                        </div>
                      )}
                    </div>
                  )}

                  {feedback.grammar && (
                    <div
                      style={{
                        background: "#F7F3FF",
                        borderRadius: 10,
                        padding: 14,
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ fontSize: 13, color: "#7C5CBF", marginBottom: 6 }}>
                        语法批改 · {feedback.grammar.errors.length} 处问题
                      </div>
                      {feedback.grammar.errors.length > 0 ? (
                        <ul style={{ margin: "4px 0 8px", paddingLeft: 18, fontSize: 14 }}>
                          {feedback.grammar.errors.map((err, i) => (
                            <li key={`${err.snippet}-${i}`} style={{ marginBottom: 6 }}>
                              <b>{err.type}</b>：{err.snippet}
                              {err.fix && <> → {err.fix}</>}
                              {err.explanation && (
                                <span style={{ color: "#8a7d6b" }}>（{err.explanation}）</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div style={{ fontSize: 14, color: "#4FBF58" }}>语法正确。</div>
                      )}
                      {feedback.grammar.corrected && (
                        <div style={{ fontSize: 14 }}>
                          <span style={{ color: "#8a7d6b" }}>参考改写：</span>
                          {feedback.grammar.corrected}
                        </div>
                      )}
                      {feedback.grammar.comment && (
                        <div style={{ fontSize: 13, color: "#8a7d6b", marginTop: 6 }}>
                          {feedback.grammar.comment}
                        </div>
                      )}
                    </div>
                  )}

                  {current.ref_answer && (
                    <div style={{ background: "#F7F3FF", borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 13, color: "#7C5CBF", marginBottom: 6 }}>参考回答</div>
                      <div style={{ fontSize: 15, lineHeight: 1.6 }}>{current.ref_answer}</div>
                    </div>
                  )}

                  <div style={{ marginTop: 16 }}>
                    <button className="btn primary" onClick={next}>
                      {index + 1 < rounds.length ? "下一轮" : "完成主题"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
