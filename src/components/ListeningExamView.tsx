import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadListeningManifest,
  resolveListeningPath,
  scanListeningExams,
  toAssetUrl,
  type ExamSummary,
  type ListeningManifest,
} from "../game/listening";
import type { Level, LevelExam } from "../game/levels";
import { sfx } from "../game/audio";
import SpeakingView from "./SpeakingView";
import SpeakingExamView from "./SpeakingExamView";
import { ArrowLeftIcon, CheckIcon, SpeakerIcon } from "./icons";

type Props = {
  onExit: () => void;
  /** 关卡模式：传入则只展示该关卡关联的 exams */
  level?: Level;
  exams?: LevelExam[];
  /** 单个 exam 完成回调 */
  onExamComplete?: (examId: string) => void;
  /** 关卡所有 exam 完成回调 */
  onLevelComplete?: () => void;
};

type AnswerState = Record<number, string>; // question_number -> user's A/B/C/D

const CHOICES = ["A", "B", "C", "D"] as const;

export default function ListeningExamView({
  onExit,
  level,
  exams: levelExams,
  onExamComplete,
  onLevelComplete,
}: Props) {
  const isLevelMode = !!level;
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedExams, setCompletedExams] = useState<Set<string>>(new Set());
  // 关卡内口语：话题为一个完整对话（≥5 轮），历史单题关联仍兼容
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [topicKey, setTopicKey] = useState<string | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [completedSpeaking, setCompletedSpeaking] = useState<Set<string>>(new Set());

  // 加载 manifest + 预解析文件 URL
  const [manifest, setManifest] = useState<ListeningManifest | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({});
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});

  const [examId, setExamId] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [finished, setFinished] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // 关卡模式：听力 exam 与口语题目按配置顺序混合展示
  const levelRows = useMemo(
    () =>
      [...(levelExams ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((e) => ({
          key: `${e.item_type}-${e.exam_id}`,
          examId: e.exam_id,
          itemType:
            e.item_type === "listening"
              ? ("listening" as const)
              : e.item_type === "speaking_topic"
                ? ("speaking_topic" as const)
                : e.item_type === "speaking_plan"
                  ? ("speaking_plan" as const)
                  : ("speaking" as const),
          title: e.name || e.exam_id,
          lang: e.lang,
        })),
    [levelExams],
  );

  const displayExams = isLevelMode
    ? levelRows
        .filter((e) => e.itemType === "listening")
        .map((e) => ({
          examId: e.examId,
          title: e.title,
          lang: e.lang,
          questionCount: 0,
          baseDir: "",
          hasAnswers: true,
        }))
    : exams;

  const reload = async () => {
    // 关卡模式下也需要扫描以获取各 exam 的 baseDir（用于解析音视频路径）
    if (!isLevelMode) {
      setLoading(true);
      setError(null);
    }
    try {
      const list = await scanListeningExams();
      setExams(list);
    } catch (e) {
      if (!isLevelMode) setError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      if (!isLevelMode) setLoading(false);
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

      // 找到 baseDir（关卡模式下可能还没扫描完，找不到时再扫一次）
      let summary = exams?.find((e) => e.examId === id);
      if (!summary) {
        const list = await scanListeningExams();
        setExams(list);
        summary = list.find((e) => e.examId === id);
      }
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

  const allQuestionsCorrect = useMemo(
    () =>
      !!manifest &&
      manifest.questions.length > 0 &&
      manifest.questions.every((q) => !!q.answer && answers[q.number] === q.answer),
    [manifest, answers],
  );

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
      // 关卡模式下，只有当前 exam 的所有题目都答对才计入完成。
      if (!isLevelMode || allQuestionsCorrect) {
        sfx.win();
      }
      if (isLevelMode && examId && allQuestionsCorrect) {
        setCompletedExams((prev) => {
          const next = new Set(prev);
          next.add(examId);
          return next;
        });
        onExamComplete?.(examId);
      }
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

  const allExamsDone = isLevelMode
    ? levelRows.length > 0 &&
      levelRows.every((row) =>
        row.itemType === "listening"
          ? completedExams.has(row.examId)
          : completedSpeaking.has(row.examId),
      )
    : false;

  const levelDoneCount = completedExams.size + completedSpeaking.size;

  // 关卡内打开口语方案：只抽取方案内题目，按等级执行歌德考试流程
  if (isLevelMode && planKey) {
    const planTitle = levelRows.find((row) => row.examId === planKey)?.title;
    return (
      <SpeakingExamView
        initialLevel={level!.difficulty}
        planId={planKey}
        topic={planTitle}
        onExit={() => setPlanKey(null)}
        onFinish={() => {
          setCompletedSpeaking((prev) => new Set(prev).add(planKey));
        }}
      />
    );
  }

  // 关卡内打开口语话题（兼容历史配置）
  if (isLevelMode && topicKey) {
    return (
      <SpeakingExamView
        initialLevel={level!.difficulty}
        topic={topicKey}
        onExit={() => setTopicKey(null)}
        onFinish={() => {
          setCompletedSpeaking((prev) => new Set(prev).add(topicKey));
        }}
      />
    );
  }

  // 关卡内打开单条口语题（兼容旧数据）
  if (isLevelMode && speakingKey) {
    return (
      <SpeakingView
        presetKeys={[speakingKey]}
        presetTitle={`${level!.name} · 口语`}
        onExit={() => setSpeakingKey(null)}
        onAllComplete={() => {
          setCompletedSpeaking((prev) => {
            const next = new Set(prev);
            next.add(speakingKey);
            return next;
          });
          setSpeakingKey(null);
        }}
      />
    );
  }

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
          <span className="level-chip" style={{ background: isLevelMode ? "#2F86D6" : "#F0A04B" }}>
            {isLevelMode ? level!.name : "自由练习"}
          </span>
          {isLevelMode && (
            <span className="quiz-count">
              已完成 {levelDoneCount} / {levelExams?.length ?? 0}
            </span>
          )}
        </div>

        <div className="play-body">
          <div style={{ width: "100%", maxWidth: 720 }}>
            <h2 style={{ marginBottom: 8 }}>
              {isLevelMode ? `综合练习 · ${level!.name}` : "本地听力素材"}
            </h2>
            {isLevelMode && level!.description && (
              <p style={{ color: "#888", marginBottom: 24 }}>{level!.description}</p>
            )}
            {!isLevelMode && (
              <p style={{ color: "#888", marginBottom: 24 }}>
                先在管理台用「听力导入」把 URL 转成题目，再把{" "}
                <code>listening/{"{exam_id}"}</code> 目录拷到客户端测试目录。
              </p>
            )}

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

            {!loading && isLevelMode && levelRows.length === 0 && (
              <div
                style={{
                  background: "#FFF8E1",
                  padding: "18px",
                  borderRadius: 10,
                  border: "1px dashed #F0A04B",
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: 8 }}>该关卡还没有关联任何题目</p>
              </div>
            )}

            {!loading && !isLevelMode && displayExams && displayExams.length === 0 && (
              <div
                style={{
                  background: "#FFF8E1",
                  padding: "18px",
                  borderRadius: 10,
                  border: "1px dashed #F0A04B",
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: 8 }}>还没有听力素材哦</p>
                <p style={{ color: "#666", fontSize: 13, lineHeight: 1.6 }}>
                  <code>LISTENING_DATA_DIR</code> 指向的目录里还没有 <code>manifest.json</code>。
                </p>
              </div>
            )}

            {allExamsDone && (
              <div
                style={{
                  background: "#E8F5E9",
                  padding: "16px",
                  borderRadius: 10,
                  marginBottom: 16,
                  textAlign: "center",
                }}
              >
                <p style={{ fontWeight: 600, color: "#27AE60", marginBottom: 8 }}>
                  🎉 恭喜！你已完成本关卡所有题目
                </p>
                <button className="btn primary" onClick={() => onLevelComplete?.()}>
                  返回地图
                </button>
              </div>
            )}

            {!loading && isLevelMode && levelRows.length > 0 && (
              <div className="word-grid" style={{ gridTemplateColumns: "1fr" }}>
                {levelRows.map((row) => {
                  const isSpeaking = row.itemType !== "listening";
                  const done = isSpeaking
                    ? completedSpeaking.has(row.examId)
                    : completedExams.has(row.examId);
                  return (
                    <button
                      key={row.key}
                      className="word-option"
                      style={{
                        textAlign: "left",
                        padding: 14,
                        height: "auto",
                        opacity: done ? 0.6 : 1,
                      }}
                      onClick={() => {
                        if (row.itemType === "listening") {
                          void enterExam(row.examId);
                        } else if (row.itemType === "speaking_topic") {
                          setTopicKey(row.examId);
                        } else if (row.itemType === "speaking_plan") {
                          setPlanKey(row.examId);
                        } else {
                          setSpeakingKey(row.examId);
                        }
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                          {isSpeaking && (
                            <span style={{ color: "#7C5CBF", marginRight: 6 }}>🗣</span>
                          )}
                          {row.title}
                          {done && (
                            <span style={{ color: "#27AE60", marginLeft: 8 }}>
                              <CheckIcon size={14} /> 已完成
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#888" }}>
                        {row.itemType === "speaking_topic"
                          ? `口语考试 · ${level?.difficulty ?? ""} 歌德形式 · ${row.lang}`
                          : row.itemType === "speaking"
                            ? `口语 · ${row.examId} · ${row.lang}`
                            : `听力 · ${row.examId} · ${row.lang}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {!loading && !isLevelMode && displayExams && displayExams.length > 0 && (
              <div className="word-grid" style={{ gridTemplateColumns: "1fr" }}>
                {displayExams.map((e) => {
                  const done = completedExams.has(e.examId);
                  return (
                    <button
                      key={e.examId}
                      className="word-option"
                      style={{
                        textAlign: "left",
                        padding: 14,
                        height: "auto",
                        opacity: done ? 0.6 : 1,
                      }}
                      onClick={() => enterExam(e.examId)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                          {e.title}
                          {done && (
                            <span style={{ color: "#27AE60", marginLeft: 8 }}>
                              <CheckIcon size={14} /> 已完成
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "#888" }}>
                        {e.examId} · {e.lang}
                      </div>
                    </button>
                  );
                })}
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
            <h2>{isLevelMode ? (allQuestionsCorrect ? "本套全部答对" : "尚未通过") : "完成啦"}</h2>
            {score.total > 0 ? (
              <p>
                你答对了 {score.correct} / {score.total} 题
              </p>
            ) : (
              <p>这套题还没有绑定官方答案，只能自己对照。</p>
            )}
            {isLevelMode && !allQuestionsCorrect && (
              <p style={{ color: "#C0392B" }}>
                所有题目都答对才会计入关卡完成，请重新做一遍。
              </p>
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
  // 判断题（答案为 R/F）显示 richtig/falsch；选择题在 OCR 提取到足够选项时显示选项文字
  const isTrueFalse = question.answer === "R" || question.answer === "F";
  const options = question.options ?? [];
  const useOptionText = !isTrueFalse && options.length >= 3;
  const choiceList: { value: string; label: string; text?: string }[] = isTrueFalse
    ? [
        { value: "R", label: "richtig" },
        { value: "F", label: "falsch" },
      ]
    : (useOptionText ? CHOICES.slice(0, options.length) : [...CHOICES]).map((letter, index) => ({
        value: letter,
        label: letter,
        text: useOptionText ? options[index] : undefined,
      }));

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

          {/* 题干画面（视频抽帧） */}
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
          </div>

          {/* 音频播放器 */}
          {audioUrls[num] ? (
            <div
              style={{
                background: "#FFF8E1",
                padding: 14,
                borderRadius: 10,
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <audio
                ref={audioRef}
                src={audioUrls[num]}
                controls
                style={{ width: "100%", minWidth: 0, flex: 1 }}
                preload="metadata"
              />
              <button
                type="button"
                className="speak-btn small"
                title="重新播放"
                aria-label="重新播放"
                onClick={() => {
                  const audio = audioRef.current;
                  if (!audio) return;
                  audio.currentTime = 0;
                  void audio.play().catch(() => {});
                }}
              >
                <SpeakerIcon size={18} />
              </button>
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

          {/* 选项：判断题显示 richtig/falsch，选择题优先显示 OCR 提取的选项文字 */}
          <div className="word-grid phrase-grid">
            {choiceList.map((choice) => {
              const isUserPick = userPick === choice.value;
              const isCorrect = question.answer === choice.value;
              const showCorrect = isRevealed && isCorrect;
              const showWrong = isRevealed && isUserPick && !isCorrect;
              return (
                <button
                  key={choice.value}
                  className={`word-option ${isUserPick && !isRevealed ? "selected" : ""} ${showCorrect ? "correct" : ""} ${showWrong ? "wrong" : ""}`}
                  onClick={() => pick(choice.value)}
                  disabled={isRevealed || !hasAnswer}
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    minHeight: 64,
                    textAlign: isTrueFalse ? "center" : "left",
                    padding: "12px 16px",
                  }}
                >
                  {choice.text ? (
                    <>
                      <span style={{ fontWeight: 700, marginRight: 8 }}>{choice.value}.</span>
                      {choice.text}
                    </>
                  ) : (
                    choice.label
                  )}
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

          {/* 转写原文：作答前后均可独立开关 */}
          {question.transcript && (
            <div style={{ marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setShowTranscript((value) => !value)}>
                {showTranscript ? "隐藏转写原文" : "显示转写原文"}
              </button>
              {showTranscript && (
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
              )}
            </div>
          )}

        </section>
      </div>
    </div>
  );
}
