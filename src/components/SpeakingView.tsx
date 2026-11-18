import { useEffect, useMemo, useState } from "react";
import {
  SPEAKING_LEVELS,
  evaluateAnswer,
  fetchSpeakingItems,
  loadSpeakingProgress,
  parsePoints,
  partLabel,
  saveSpeakingProgress,
  type SpeakingFeedback,
  type SpeakingItem,
  type SpeakingLevel,
} from "../game/speaking";
import { sfx } from "../game/audio";
import { ArrowLeftIcon, CheckIcon } from "./icons";

type Props = {
  onExit: () => void;
  /** 关卡模式：只练习这些口语题目 */
  presetKeys?: string[];
  presetTitle?: string;
  onAllComplete?: () => void;
};

const LEVEL_COLORS: Record<SpeakingLevel, string> = {
  A1: "#4FBF58",
  A2: "#2F86D6",
  B1: "#FF8A3D",
  B2: "#F2588E",
  C1: "#8E44AD",
  C2: "#6C3483",
};

export default function SpeakingView({ onExit, presetKeys, presetTitle, onAllComplete }: Props) {
  const isPreset = !!presetKeys;
  const [items, setItems] = useState<SpeakingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<SpeakingLevel>("A1");

  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<SpeakingFeedback | null>(null);
  const [finished, setFinished] = useState(false);
  const [completed, setCompleted] = useState<string[]>(() => loadSpeakingProgress().completed);

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

  const levelItems = useMemo(() => {
    if (presetKeys) {
      const keys = new Set(presetKeys);
      return items.filter((it) => keys.has(it.item_key));
    }
    return items.filter((it) => it.level === level);
  }, [items, level, presetKeys]);

  const current = levelItems[index] ?? null;

  const resetLevel = (nextLevel: SpeakingLevel) => {
    setLevel(nextLevel);
    setIndex(0);
    setAnswer("");
    setFeedback(null);
    setFinished(false);
  };

  const submit = () => {
    if (!current || !answer.trim()) return;
    const fb = evaluateAnswer(current, answer);
    setFeedback(fb);
    if (fb.missing.length === 0 && !fb.tooShort) {
      sfx.correct();
    } else {
      sfx.tap();
    }
    if (!completed.includes(current.item_key)) {
      const next = [...completed, current.item_key];
      setCompleted(next);
      saveSpeakingProgress({ completed: next });
    }
  };

  const next = () => {
    setFeedback(null);
    setAnswer("");
    if (index + 1 < levelItems.length) {
      setIndex(index + 1);
    } else {
      setFinished(true);
      sfx.win();
      if (isPreset) onAllComplete?.();
    }
  };

  const restart = () => {
    setIndex(0);
    setAnswer("");
    setFeedback(null);
    setFinished(false);
  };

  const doneCount = levelItems.filter((it) => completed.includes(it.item_key)).length;

  return (
    <div className="play-screen">
      <div className="play-topbar">
        <button className="back-btn" onClick={onExit}>
          <ArrowLeftIcon size={18} />
          返回
        </button>
        <span className="level-chip" style={{ background: "#7C5CBF" }}>
          {isPreset ? presetTitle ?? "口语练习" : "口语练习 · 脚本模式"}
        </span>
        <span className="quiz-count">
          已完成 {doneCount} / {levelItems.length}
        </span>
      </div>

      <div className="play-body">
        <div style={{ width: "100%", maxWidth: 760 }}>
          <p style={{ color: "#8a7d6b", fontSize: 13, marginTop: 0 }}>
            机器批改仅用于练习辅助，不能替代歌德官方人工口试。
          </p>

          {!isPreset && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
              {SPEAKING_LEVELS.map((lv) => {
                const count = items.filter((it) => it.level === lv).length;
                const active = lv === level;
                return (
                  <button
                    key={lv}
                    className="btn ghost"
                    disabled={count === 0}
                    onClick={() => resetLevel(lv)}
                    style={{
                      background: active ? LEVEL_COLORS[lv] : undefined,
                      color: active ? "#fff" : undefined,
                      opacity: count === 0 ? 0.4 : 1,
                    }}
                  >
                    {lv} · {count} 题
                  </button>
                );
              })}
            </div>
          )}

          {loading && <p style={{ color: "#8a7d6b" }}>正在加载口语题库…</p>}

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
              题库加载失败：{error}
              <button className="btn ghost" style={{ marginLeft: 12 }} onClick={load}>
                重试
              </button>
            </div>
          )}

          {!loading && !error && levelItems.length === 0 && (
            <p style={{ color: "#999" }}>该等级暂无口语题目。</p>
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
                <CheckIcon size={20} /> {isPreset ? "口语部分完成" : "本等级练习完成"}
              </h2>
              <p style={{ color: "#6b6156" }}>
                共完成 {levelItems.length} 题，累计已练习 {doneCount} 题。
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
                <button className="btn primary" onClick={restart}>
                  再来一轮
                </button>
                <button className="btn ghost" onClick={isPreset ? onAllComplete : onExit}>
                  {isPreset ? "返回关卡" : "返回地图"}
                </button>
              </div>
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
                  {partLabel(current.exam_part)} · {current.topic}
                </span>
                <span style={{ color: "#8a7d6b", fontSize: 13 }}>
                  第 {index + 1} / {levelItems.length} 题
                </span>
              </div>

              <h2 style={{ margin: "14px 0 6px", fontSize: 24 }}>{current.prompt_de}</h2>
              {current.prompt_zh && (
                <p style={{ color: "#8a7d6b", marginTop: 0 }}>{current.prompt_zh}</p>
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
                  <button className="btn primary" onClick={submit} disabled={!answer.trim()}>
                    提交回答
                  </button>
                  <button className="btn ghost" onClick={next}>
                    跳过
                  </button>
                </div>
              )}

              {feedback && (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      background: "#F4FBF4",
                      borderRadius: 10,
                      padding: 14,
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ fontSize: 13, color: "#6b6156", marginBottom: 6 }}>
                      要点覆盖：{feedback.covered.length} /{" "}
                      {feedback.covered.length + feedback.missing.length}
                    </div>
                    {feedback.missing.length > 0 ? (
                      <div style={{ fontSize: 14 }}>
                        还可补充：
                        {feedback.missing.map((p) => (
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
                    {feedback.tooShort && (
                      <div style={{ fontSize: 13, color: "#C0392B", marginTop: 8 }}>
                        回答偏短，建议补充完整句子。
                      </div>
                    )}
                    {(!feedback.startsUpper || !feedback.endsPunct) && (
                      <div style={{ fontSize: 13, color: "#B9770E", marginTop: 6 }}>
                        书写提示：{!feedback.startsUpper ? "句首单词请大写" : ""}
                        {!feedback.startsUpper && !feedback.endsPunct ? "；" : ""}
                        {!feedback.endsPunct ? "句末请加标点" : ""}。
                      </div>
                    )}
                  </div>

                  <div style={{ background: "#F7F3FF", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 13, color: "#7C5CBF", marginBottom: 6 }}>参考回答</div>
                    <div style={{ fontSize: 15, lineHeight: 1.6 }}>{current.ref_answer}</div>
                    {current.error_note && (
                      <div style={{ fontSize: 13, color: "#8a7d6b", marginTop: 8 }}>
                        语法提示：{current.error_note}
                      </div>
                    )}
                  </div>

                  {parsePoints(current.expected_points).length > 0 && (
                    <div style={{ fontSize: 12, color: "#a99a86", marginTop: 10 }}>
                      本题要点：{parsePoints(current.expected_points).join(" / ")}
                    </div>
                  )}

                  <div style={{ marginTop: 16 }}>
                    <button className="btn primary" onClick={next}>
                      {index + 1 < levelItems.length ? "下一题" : "完成练习"}
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
