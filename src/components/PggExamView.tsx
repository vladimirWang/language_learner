import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  EXAM_SECTION_LABELS,
  EXAM_SECTION_ORDER,
  OBJECTIVE_SECTIONS,
  fetchExamDiktat,
  fetchExamMaterial,
  fetchExamPapers,
  fetchExamQuestions,
  fetchExamWriting,
  submitExamAnswer,
  type ExamAnswerResult,
  type ExamDiktat,
  type ExamMaterial,
  type ExamPaper,
  type ExamQuestion,
  type ExamSection,
  type ExamWriting,
} from "../game/exam";
import { ArrowLeftIcon } from "./icons";

type Props = {
  onExit: () => void;
};

type AnswerState = {
  picked: string;
  result: ExamAnswerResult;
};

const CARD_STYLE = {
  background: "#fff",
  borderRadius: 14,
  border: "1px solid #efe6d8",
  padding: "16px 18px",
  marginBottom: 14,
} as const;

/** 德专四级（PGG）真题客观题练习入口。 */
export default function PggExamView({ onExit }: Props) {
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [paperId, setPaperId] = useState("");
  const [section, setSection] = useState<ExamSection>("lesen");
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [diktat, setDiktat] = useState<ExamDiktat[]>([]);
  const [writing, setWriting] = useState<ExamWriting[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [materials, setMaterials] = useState<ExamMaterial[]>([]);
  const [showMaterial, setShowMaterial] = useState(false);
  const [showDiktatText, setShowDiktatText] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchExamPapers()
      .then((list) => {
        setPapers(list);
        if (list.length > 0) setPaperId(list[0].paper_id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const paper = useMemo(
    () => papers.find((item) => item.paper_id === paperId) ?? null,
    [papers, paperId],
  );

  const sections = useMemo(() => {
    if (!paper) return [] as ExamSection[];
    return EXAM_SECTION_ORDER.filter((item) => paper.sections.includes(item));
  }, [paper]);

  // 切换试卷后若当前题型不存在，自动落到第一个可用题型。
  useEffect(() => {
    if (!paper || sections.length === 0) return;
    if (!sections.includes(section)) {
      setSection(sections[0]);
    }
  }, [paper, sections, section]);

  useEffect(() => {
    if (!paperId) return;
    let cancelled = false;
    setContentLoading(true);
    setError(null);
    setAnswers({});
    setMaterials([]);
    setShowMaterial(false);
    setShowDiktatText(false);

    const isObjective = OBJECTIVE_SECTIONS.includes(section);
    const task = isObjective
      ? fetchExamQuestions(paperId, section).then((items) => {
          if (cancelled) return;
          setQuestions(items);
          setDiktat([]);
          setWriting([]);
        })
      : section === "diktat"
        ? fetchExamDiktat(paperId).then((items) => {
            if (cancelled) return;
            setDiktat(items);
            setQuestions([]);
            setWriting([]);
          })
        : fetchExamWriting(paperId).then((items) => {
            if (cancelled) return;
            setWriting(items);
            setQuestions([]);
            setDiktat([]);
          });

    task
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paperId, section]);

  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.values(answers).filter(
    (item) => item.result.is_correct === true,
  ).length;

  const answerQuestion = async (question: ExamQuestion, option: string) => {
    if (pending || answers[question.q_no]) return;
    const letter = option.trim().slice(0, 1).toUpperCase();
    if (!letter) return;
    setPending(question.q_no);
    try {
      const result = await submitExamAnswer(paperId, section, question.q_no, letter);
      setAnswers((prev) => ({ ...prev, [question.q_no]: { picked: letter, result } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  const toggleMaterial = async () => {
    if (showMaterial) {
      setShowMaterial(false);
      return;
    }
    setShowMaterial(true);
    if (materials.length > 0) return;
    try {
      setMaterials(await fetchExamMaterial(paperId, section));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const chipStyle = (active: boolean): CSSProperties => ({
    border: active ? "1px solid #D8863C" : "1px solid #e6dccb",
    background: active ? "#FFF4E6" : "#fff",
    color: active ? "#B2661F" : "#5b4a36",
    borderRadius: 999,
    padding: "6px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  });

  return (
    <div className="map-screen">
      <header className="map-header">
        <div className="brand">
          <h1 className="brand-title">德专四级 PGG</h1>
          <p className="brand-sub">真题客观题练习：听力理解、阅读理解、语法与词汇</p>
        </div>
        <div className="header-actions">
          <button className="agent-entry" onClick={onExit}>
            <ArrowLeftIcon size={16} /> 返回
          </button>
        </div>
      </header>

      <div className="map-viewport">
        <div
          className="map-canvas"
          style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 60px" }}
        >
          {error && (
            <div style={{ ...CARD_STYLE, borderColor: "#f0c9c2", color: "#C0392B" }}>{error}</div>
          )}

          {loading && <div style={{ color: "#8a7d6b" }}>正在加载试卷…</div>}

          {!loading && papers.length === 0 && (
            <div style={{ ...CARD_STYLE, color: "#8a7d6b", textAlign: "center" }}>
              暂无已解析的 PGG 试卷，请先在管理后台导入并解析真题 PDF。
            </div>
          )}

          {paper && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {papers.map((item) => (
                  <button
                    key={item.paper_id}
                    style={chipStyle(item.paper_id === paperId)}
                    onClick={() => setPaperId(item.paper_id)}
                  >
                    {item.title || item.paper_id}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {sections.map((item) => (
                  <button
                    key={item}
                    style={chipStyle(item === section)}
                    onClick={() => setSection(item)}
                  >
                    {EXAM_SECTION_LABELS[item] ?? item}
                  </button>
                ))}
                {sections.length === 0 && (
                  <span style={{ color: "#8a7d6b", fontSize: 13 }}>该套卷暂无可用题型</span>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                {OBJECTIVE_SECTIONS.includes(section) && (
                  <span style={{ fontSize: 13, color: "#8a7d6b" }}>
                    已答 {answeredCount} / {questions.length}，正确 {correctCount}
                  </span>
                )}
                {(OBJECTIVE_SECTIONS.includes(section) ||
                  section === "diktat" ||
                  section === "writing") && (
                  <button className="btn ghost" onClick={toggleMaterial}>
                    {showMaterial ? "收起原文" : "查看原文"}
                  </button>
                )}
                {contentLoading && (
                  <span style={{ fontSize: 13, color: "#a99a86" }}>加载中…</span>
                )}
              </div>

              {showMaterial && (
                <div style={CARD_STYLE}>
                  <div style={{ fontSize: 13, color: "#a99a86", marginBottom: 8 }}>
                    原文素材（{EXAM_SECTION_LABELS[section] ?? section}）
                  </div>
                  {materials.length === 0 ? (
                    <p style={{ color: "#8a7d6b", fontSize: 14 }}>暂无原文素材</p>
                  ) : (
                    materials.map((item) => (
                      <div key={`${item.page_no}`} style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, color: "#b9ab97" }}>第 {item.page_no} 页</div>
                        <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, margin: "4px 0" }}>
                          {item.raw_text}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {OBJECTIVE_SECTIONS.includes(section) &&
                !contentLoading &&
                questions.length === 0 && (
                  <div style={{ ...CARD_STYLE, color: "#8a7d6b", textAlign: "center" }}>
                    该题型暂无题目
                  </div>
                )}

              {OBJECTIVE_SECTIONS.includes(section) &&
                questions.map((question) => {
                  const state = answers[question.q_no];
                  return (
                    <div key={`${question.section}-${question.q_no}`} style={CARD_STYLE}>
                      <div style={{ fontSize: 12, color: "#b9ab97" }}>第 {question.q_no} 题</div>
                      <div style={{ fontSize: 15, margin: "6px 0 10px", whiteSpace: "pre-wrap" }}>
                        {question.stem}
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {question.options.map((option) => {
                          const letter = option.trim().slice(0, 1).toUpperCase();
                          const picked = state?.picked === letter;
                          const correctOption = state?.result.correct_answer === letter;
                          let border = "1px solid #e6dccb";
                          let background = "#fff";
                          if (state) {
                            if (correctOption) {
                              border = "1px solid #4FBF58";
                              background = "#F2FBF2";
                            } else if (picked) {
                              border = "1px solid #C0392B";
                              background = "#FDF2F0";
                            }
                          }
                          return (
                            <button
                              key={option}
                              disabled={!!state || pending === question.q_no}
                              onClick={() => answerQuestion(question, option)}
                              style={{
                                textAlign: "left",
                                border,
                                background,
                                borderRadius: 10,
                                padding: "10px 12px",
                                fontSize: 14,
                                fontFamily: "inherit",
                                cursor: state ? "default" : "pointer",
                              }}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                      {state && (
                        <div
                          style={{
                            marginTop: 10,
                            fontSize: 13,
                            color:
                              state.result.is_correct === false
                                ? "#C0392B"
                                : state.result.is_correct === true
                                  ? "#2E7D32"
                                  : "#8a7d6b",
                          }}
                        >
                          {state.result.is_correct === null
                            ? state.result.message ?? "该题尚未绑定标准答案"
                            : state.result.is_correct
                              ? "回答正确"
                              : `回答错误，正确答案 ${state.result.correct_answer}`}
                        </div>
                      )}
                    </div>
                  );
                })}

              {section === "diktat" && !contentLoading && diktat.length === 0 && (
                <div style={{ ...CARD_STYLE, color: "#8a7d6b", textAlign: "center" }}>
                  该套卷暂无听写原文
                </div>
              )}

              {section === "diktat" &&
                diktat.map((item) => (
                  <div key={item.paper_id} style={CARD_STYLE}>
                    <div style={{ fontSize: 13, color: "#a99a86" }}>
                      听写原文 · {item.word_count} 词
                    </div>
                    <p style={{ fontSize: 13, color: "#8a7d6b", margin: "8px 0" }}>
                      音频播放与逐词批改待接入，可先阅读原文准备。
                    </p>
                    <button className="btn ghost" onClick={() => setShowDiktatText((v) => !v)}>
                      {showDiktatText ? "隐藏原文" : "显示原文"}
                    </button>
                    {showDiktatText && (
                      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, marginTop: 10 }}>
                        {item.full_text}
                      </p>
                    )}
                  </div>
                ))}

              {section === "writing" && !contentLoading && writing.length === 0 && (
                <div style={{ ...CARD_STYLE, color: "#8a7d6b", textAlign: "center" }}>
                  该套卷暂无写作题干
                </div>
              )}

              {section === "writing" &&
                writing.map((item) => (
                  <div key={`${item.paper_id}-${item.prompt}`} style={CARD_STYLE}>
                    <div style={{ fontSize: 13, color: "#a99a86" }}>
                      书面表达{item.word_limit ? ` · 约 ${item.word_limit} 词` : ""}
                    </div>
                    <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, marginTop: 8 }}>
                      {item.prompt}
                    </p>
                    <p style={{ fontSize: 13, color: "#8a7d6b" }}>
                      写作批改链路待接入。
                    </p>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
