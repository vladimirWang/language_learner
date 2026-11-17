import { useEffect, useMemo, useState } from "react";
import {
  loadListeningManifest,
  resolveListeningPath,
  scanListeningExams,
  toAssetUrl,
  type ExamSummary,
  type ListeningManifest,
} from "../game/listening";
import { sfx } from "../game/audio";
import { ArrowLeftIcon, CheckIcon, SpeakerIcon } from "./icons";

type Props = {
  onExit: () => void;
};

type AnswerState = Record<number, string>; // question_number -> user's A/B/C/D

const CHOICES = ["A", "B", "C", "D"] as const;

export default function ListeningExamView({ onExit }: Props) {
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载 manifest + 预解析文件 URL
  const [manifest, setManifest] = useState<ListeningManifest | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({});
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});

  const [examId, setExamId] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [finished, setFinished] = useState(false);

  // 扫描本地素材
  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await scanListeningExams();
      setExams(list);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // 选中某个 exam → 加载 manifest + 预解析路径
  const enterExam = async (id: string) => {
    setExamId(id);
    setLoading(true);
    setError(null);
    try {
      const mf = await loadListeningManifest(id);
      setManifest(mf);

      // 找到 baseDir
      const summary = exams?.find((e) => e.examId === id);
      const baseDir = summary?.baseDir ?? "";

      const aMap: Record<number, string> = {};
      const iMap: Record<number, string> = {};
      for (const q of mf.questions) {
        if (q.audio) {
          try {
            const p = await resolveListeningPath(baseDir, q.audio);
            aMap[q.number] = toAssetUrl(p);
          } catch {
            // 忽略个别缺失
          }
        }
        if (q.image) {
          try {
            const p = await resolveListeningPath(baseDir, q.image);
            iMap[q.number] = toAssetUrl(p);
          } catch {
            // 忽略
          }
        }
      }
      setAudioUrls(aMap);
      setImageUrls(iMap);
      setAnswers({});
      setRevealed(new Set());
      setCurrent(0);
      setFinished(false);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const question = useMemo(
    () => manifest?.questions[current] ?? null,
    [manifest, current],
  );

  const score = useMemo(() => {
    if (!manifest) return { correct: 0, total: 0 };
    let correct = 0;
    let total = 0;
    for (const q of manifest.questions) {
      if (q.answer) {
        total++;
        if (answers[q.number] === q.answer) correct++;
      }
    }
    return { correct, total };
  }, [manifest, answers]);

  const pick = (letter: string) => {
    if (!question) return;
    const num = question.number;
    if (revealed.has(num)) return; // 已揭示就不能改了
    setAnswers((prev) => ({ ...prev, [num]: letter }));
    if (letter === question.answer) {
      sfx.correct();
    } else {
      sfx.wrong();
    }
  };

  const reveal = () => {
    if (!question) return;
    setRevealed((prev) => {
      const next = new Set(prev);
      next.add(question.number);
      return next;
    });
  };

  const next = () => {
    if (!manifest) return;
    if (current < manifest.questions.length - 1) {
      setCurrent((c) => c + 1);
    } else {
      setFinished(true);
      sfx.win();
    }
  };

  const prev = () => {
    if (current > 0) setCurrent((c) => c - 1);
  };

  const leaveExam = () => {
    setExamId(null);
    setManifest(null);
    setAnswers({});
    setRevealed(new Set());
    setAudioUrls({});
    setImageUrls({});
  };

  // ========== 渲染 ==========

  // 空：素材列表
  if (!examId) {
    return (
      <div className="play-screen">
        <div className="play-topbar">
          <button className="back-btn" onClick={onExit}>
            <ArrowLeftIcon size={18} />
            返回
          </button>
          <span className="level-chip" style={{ background: "#F0A04B" }}>
            听力导入练习
          </span>
        </div>

        <div className="play-body">
          <div style={{ width: "100%", maxWidth: 720 }}>
            <h2 style={{ marginBottom: 8 }}>本地听力素材</h2>
            <p style={{ color: "#888", marginBottom: 24 }}>
              先在管理台用「听力导入」把 URL 转成题目，再把{" "}
              <code>listening/{"{exam_id}"}</code> 目录拷到客户端测试目录。
            </p>

            {error && (
              <div
                style={{
                  background: "#FEECEC",
                  color: "#C0392B",
                  padding: "10px 14px",
                  borderRadius: 8,
                  marginBottom: 16,
                }}
              >
                {error}
              </div>
            )}

            {loading && <div>扫描中…</div>}

            {!loading && exams && exams.length === 0 && (
              <div
                style={{
                  background: "#FFF8E1",
                  padding: "18px",
                  borderRadius: 10,
                  border: "1px dashed #F0A04B",
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: 8 }}>
                  还没有听力素材哦
                </p>
                <p style={{ color: "#666", fontSize: 13, lineHeight: 1.6 }}>
                  <code>
                    LISTENING_DATA_DIR
                  </code>{" "}
                  指向的目录（默认是 app_data/listening）里还没有{" "}
                  <code>manifest.json</code>。
                  <br />
                  快速测试：
                  <br />
                  <span style={{ color: "#888" }}>
                    cp -r builder/work/listening/goethe-a1-hoeren-01 /tmp/client-data/listening/
                  </span>
                  <br />
                  然后用{" "}
                  <code>LISTENING_DATA_DIR=/tmp/client-data/listening</code>{" "}
                  启动。
                </p>
              </div>
            )}

            {!loading && exams && exams.length > 0 && (
              <div className="word-grid" style={{ gridTemplateColumns: "1fr" }}>
                {exams.map((e) => (
                  <button
                    key={e.examId}
                    className="word-option"
                    style={{ textAlign: "left", padding: 14, height: "auto" }}
                    onClick={() => enterExam(e.examId)}
                  >
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                      {e.title}
                    </div>
                    <div style={{ fontSize: 12, color: "#888" }}>
                      {e.examId} · {e.lang} · {e.questionCount} 题
                      {e.hasAnswers ? (
                        <span style={{ color: "#27AE60", marginLeft: 8 }}>
                          ✓ 已绑定答案
                        </span>
                      ) : (
                        <span style={{ color: "#E67E22", marginLeft: 8 }}>
                          ⚠ 无答案（无法判分）
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 加载 manifest 中
  if (!manifest || loading) {
    return (
      <div className="play-screen">
        <div className="play-body">
          <div className="empty-card">加载中…</div>
        </div>
      </div>
    );
  }

  // 完成页
  if (finished) {
    return (
      <div className="play-screen">
        <div className="play-body">
          <div className="empty-card" style={{ maxWidth: 420 }}>
            <h2>完成啦</h2>
            {score.total > 0 ? (
              <p>
                你答对了 {score.correct} / {score.total} 题
              </p>
            ) : (
              <p>这套题还没有绑定官方答案，只能自己对照。</p>
            )}
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button className="btn ghost" onClick={leaveExam}>
                回到素材列表
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setAnswers({});
                  setRevealed(new Set());
                  setCurrent(0);
                  setFinished(false);
                }}
              >
                重新做一遍
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 主播放区
  if (!question) return null;
  const num = question.number;
  const userPick = answers[num];
  const isRevealed = revealed.has(num);
  const hasAnswer = !!question.answer;

  return (
    <div className="play-screen">
      <div className="play-topbar">
        <button className="back-btn" onClick={leaveExam}>
          <ArrowLeftIcon size={18} />
          退出练习
        </button>
        <div className="quiz-status">
          <div className="quiz-progress">
            {manifest.questions.map((_, i) => (
              <span
                key={i}
                className={`quiz-seg ${i < current ? "done" : i === current ? "active" : ""}`}
              />
            ))}
          </div>
          <span className="quiz-count">
            第 {current + 1} / {manifest.questions.length} 题
          </span>
        </div>
        {score.total > 0 && (
          <span className="level-chip" style={{ background: "#27AE60" }}>
            {score.correct}/{score.total}
          </span>
        )}
      </div>

      <div className="play-body">
        <section className="phase" style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
          <div className="prompt">
            <span className="prompt-eyebrow">Hören · Nummer {num}</span>
            <h2>听音频，选一个正确答案</h2>
          </div>

          {/* 题干画面（视频抽帧 + OCR） */}
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            {imageUrls[num] ? (
              <img
                src={imageUrls[num]}
                alt="题干画面"
                style={{
                  maxWidth: "100%",
                  maxHeight: 280,
                  borderRadius: 10,
                  boxShadow: "0 2px 10px rgba(0,0,0,.08)",
                }}
              />
            ) : (
              <div
                style={{
                  height: 180,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#f5f5f5",
                  borderRadius: 10,
                  color: "#aaa",
                }}
              >
                无画面
              </div>
            )}
            {question.ocrText && (
              <div
                style={{
                  marginTop: 10,
                  textAlign: "left",
                  background: "#FAFAFA",
                  padding: 10,
                  borderRadius: 8,
                  fontSize: 13,
                  color: "#555",
                  lineHeight: 1.6,
                }}
              >
                {question.ocrText}
              </div>
            )}
          </div>

          {/* 音频播放器 */}
          {audioUrls[num] ? (
            <div
              style={{
                background: "#FFF8E1",
                padding: 14,
                borderRadius: 10,
                marginBottom: 20,
              }}
            >
              <audio
                src={audioUrls[num]}
                controls
                style={{ width: "100%" }}
                preload="metadata"
              />
            </div>
          ) : (
            <div
              style={{
                padding: 14,
                borderRadius: 10,
                marginBottom: 20,
                background: "#FEECEC",
                color: "#C0392B",
              }}
            >
              音频文件缺失
            </div>
          )}

          {/* 选项 */}
          <div className="word-grid phrase-grid">
            {CHOICES.map((letter) => {
              const isUserPick = userPick === letter;
              const isCorrect = question.answer === letter;
              const showCorrect = isRevealed && isCorrect;
              const showWrong = isRevealed && isUserPick && !isCorrect;
              return (
                <button
                  key={letter}
                  className={`word-option ${showCorrect ? "correct" : ""} ${showWrong ? "wrong" : ""}`}
                  onClick={() => pick(letter)}
                  disabled={isRevealed || !hasAnswer}
                  style={{ fontSize: 20, fontWeight: 700, minHeight: 64 }}
                >
                  {letter}
                  {(showCorrect || showWrong) && (
                    <span className="option-check">
                      <CheckIcon size={18} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {!hasAnswer && (
            <div style={{ marginTop: 12, color: "#E67E22", fontSize: 13 }}>
              这道题没有绑定官方答案，无法自动判分。
            </div>
          )}

          {/* 操作按钮 */}
          <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "center" }}>
            <button
              className="btn ghost"
              onClick={prev}
              disabled={current === 0}
            >
              上一题
            </button>
            {hasAnswer && !isRevealed && userPick && (
              <button className="btn primary" onClick={reveal}>
                看答案
              </button>
            )}
            <button className="btn primary" onClick={next}>
              {current < manifest.questions.length - 1 ? "下一题" : "看成绩"}
            </button>
          </div>

          {/* 原文（可折叠展示） */}
          {isRevealed && question.transcript && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: "pointer", color: "#888", fontSize: 13 }}>
                查看音频转写原文
              </summary>
              <p
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: "#555",
                  background: "#FAFAFA",
                  padding: 10,
                  borderRadius: 8,
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                }}
              >
                {question.transcript}
              </p>
            </details>
          )}

          {/* 音频重播按钮 */}
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button
              className="speak-btn small"
              onClick={() => {
                const a = document.querySelector<HTMLAudioElement>("audio");
                if (a) {
                  a.currentTime = 0;
                  a.play().catch(() => {});
                }
              }}
            >
              <SpeakerIcon size={18} /> 重新播放
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
