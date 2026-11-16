import { useEffect, useRef, useState } from "react";
import type { QuizBatch } from "../game/agent";
import { sfx } from "../game/audio";
import { CheckIcon } from "./icons";

type Props = {
  batch: QuizBatch;
  onRepeat: () => void;
};

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export default function AgentQuiz({ batch, onRepeat }: Props) {
  const [current, setCurrent] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 作答后把说明和「下一题」滚进可视区，避免被底部输入栏挡住。
  useEffect(() => {
    if (picked === null) return;
    cardRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [picked, finished]);

  const total = batch.questions.length;
  const kindLabel = batch.kind === "grammar" ? "语法" : "单词";

  if (total === 0) {
    return (
      <div className="agent-quiz">
        <div className="agent-quiz-head">
          <span className={`agent-tag ${batch.kind}`}>
            {batch.level} {kindLabel}
          </span>
        </div>
        <p className="agent-quiz-empty">
          这组暂时没有可用题目。换一个难度或题型试试，或者先到素材库补充内容。
        </p>
      </div>
    );
  }

  if (finished) {
    const allRight = correctCount === total;
    return (
      <div className="agent-quiz agent-summary" ref={cardRef}>
        <div className="agent-summary-emoji" aria-hidden="true">
          {allRight ? "★" : "☆"}
        </div>
        <h3>{allRight ? "全对，太棒了！" : "本组完成"}</h3>
        <p>
          {batch.level} {kindLabel}题 · 答对 {correctCount} / {total}
        </p>
        <div className="agent-summary-actions">
          <button className="btn primary" onClick={onRepeat}>
            再来一组
          </button>
        </div>
      </div>
    );
  }

  const question = batch.questions[current];
  const answered = picked !== null;
  const isRight = picked === question.answerIndex;

  const pick = (index: number) => {
    if (answered) return;
    setPicked(index);
    if (index === question.answerIndex) {
      setCorrectCount((value) => value + 1);
      sfx.correct();
    } else {
      sfx.wrong();
    }
  };

  const next = () => {
    if (!answered) return;
    if (current + 1 >= total) {
      setFinished(true);
      sfx.win();
      return;
    }
    setCurrent((value) => value + 1);
    setPicked(null);
  };

  return (
    <div className="agent-quiz" ref={cardRef}>
      <div className="agent-quiz-head">
        <span className={`agent-tag ${batch.kind}`}>
          {batch.level} {kindLabel}
        </span>
        <span className="agent-quiz-count">
          第 {current + 1} / {total} 题
        </span>
      </div>

      <div className="agent-quiz-progress">
        {batch.questions.map((item, index) => (
          <span
            key={item.id}
            className={`agent-seg ${index < current ? "done" : index === current ? "active" : ""}`}
          />
        ))}
      </div>

      <p className="agent-quiz-prompt">{question.prompt}</p>
      {question.hint && <p className="agent-quiz-hint">{question.hint}</p>}

      <div className="agent-quiz-options">
        {question.options.map((option, index) => {
          const isAnswer = index === question.answerIndex;
          const state = !answered
            ? ""
            : isAnswer
              ? "correct"
              : index === picked
                ? "wrong"
                : "dim";
          return (
            <button
              key={`${question.id}-${index}`}
              className={`agent-option ${state}`}
              onClick={() => pick(index)}
              disabled={answered}
            >
              <span className="agent-option-key">{LETTERS[index] ?? index + 1}</span>
              <span className="agent-option-text">{option}</span>
              {answered && isAnswer && (
                <span className="agent-option-check">
                  <CheckIcon size={14} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className={`agent-feedback ${isRight ? "ok" : "bad"}`}>
          <strong>{isRight ? "答对啦" : "记住这个答案"}</strong>
          <p>{question.explanation}</p>
        </div>
      )}

      <div className="agent-quiz-foot">
        <button className="btn ghost" onClick={next} disabled={!answered}>
          {current + 1 >= total ? "查看结果" : "下一题"}
        </button>
      </div>
    </div>
  );
}
