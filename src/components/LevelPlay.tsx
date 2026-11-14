import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  COURSES,
  buildQuestions,
  type DialogueQuestion,
  type PhraseQuestion,
} from "../game/courses";
import { sfx, speak } from "../game/audio";
import RainbowText from "./RainbowText";
import Confetti from "./Confetti";
import { ArrowLeftIcon, CheckIcon, SpeakerIcon } from "./icons";

type Props = {
  index: number;
  onExit: () => void;
  onComplete: (index: number, stars: number) => void;
  onNext: (index: number) => void;
};

type InputState = "idle" | "wrong" | "correct";

/** 大小写与标点保持一致，仅忽略首尾与多余空格、统一弯引号 */
function normalizeAnswer(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export default function LevelPlay({ index, onExit, onComplete, onNext }: Props) {
  const course = COURSES[index];
  const questions = useMemo(() => (course ? buildQuestions(course) : []), [index]);
  const [current, setCurrent] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [input, setInput] = useState("");
  const [inputState, setInputState] = useState<InputState>("idle");
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [pickedPhrase, setPickedPhrase] = useState<string | null>(null);
  const [shakeId, setShakeId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [stars, setStars] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  const later = (fn: () => void, delay: number) => {
    const id = window.setTimeout(fn, delay);
    timers.current.push(id);
  };

  const question = questions[current];
  const isLast = current >= questions.length - 1;

  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current = [];
    };
  }, []);

  useEffect(() => {
    if (!question) return;
    if (question.kind === "dialogue") {
      inputRef.current?.focus();
      later(() => speak(question.shown), 350);
    }
    // 只在切换题目时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const finishLevel = (mistakeCount: number) => {
    const earned = mistakeCount === 0 ? 3 : mistakeCount <= 2 ? 2 : 1;
    setStars(earned);
    setFinished(true);
    sfx.win();
    onComplete(index, earned);
  };

  const advance = () => {
    setInput("");
    setInputState("idle");
    setWrongIds([]);
    setPickedPhrase(null);
    setShakeId(null);
    setCurrent((value) => value + 1);
  };

  const afterCorrect = () => {
    const finalMistakes = mistakes;
    later(() => {
      if (isLast) finishLevel(finalMistakes);
      else advance();
    }, 820);
  };

  const submitAnswer = (event: FormEvent) => {
    event.preventDefault();
    if (!question || question.kind !== "dialogue" || inputState === "correct") return;
    if (!input.trim()) return;

    if (normalizeAnswer(input) === normalizeAnswer(question.answer)) {
      setInputState("correct");
      sfx.correct();
      speak(question.answer);
      afterCorrect();
    } else {
      setMistakes((value) => value + 1);
      setInputState("wrong");
      sfx.wrong();
      later(() => setInputState((value) => (value === "wrong" ? "idle" : value)), 700);
    }
  };

  const choosePhrase = (option: string) => {
    if (!question || question.kind !== "phrase" || pickedPhrase) return;
    if (option === question.text) {
      setPickedPhrase(option);
      sfx.correct();
      speak(option);
      afterCorrect();
    } else {
      setMistakes((value) => value + 1);
      setWrongIds((ids) => (ids.includes(option) ? ids : [...ids, option]));
      setShakeId(option);
      sfx.wrong();
      later(() => setShakeId(null), 450);
    }
  };

  if (!course) {
    return (
      <div className="play-screen">
        <div className="play-body">
          <div className="empty-card">
            <p>课程不存在或已被删除</p>
            <button className="btn ghost" onClick={onExit}>
              回到地图
            </button>
          </div>
        </div>
      </div>
    );
  }

  const dialogue: DialogueQuestion | null =
    question?.kind === "dialogue" ? question : null;
  const phrase: PhraseQuestion | null = question?.kind === "phrase" ? question : null;

  return (
    <div className="play-screen">
      <div className="play-topbar">
        <button className="back-btn" onClick={onExit}>
          <ArrowLeftIcon size={18} />
          地图
        </button>
        <div className="quiz-status">
          <div className="quiz-progress">
            {questions.map((item, i) => (
              <span
                key={item.id}
                className={`quiz-seg ${i < current ? "done" : i === current ? "active" : ""}`}
              />
            ))}
          </div>
          <span className="quiz-count">
            {questions.length === 0
              ? "暂无题目"
              : `第 ${current + 1} / ${questions.length} 题`}
          </span>
        </div>
        <span className="level-chip" style={{ background: course.accent }}>
          第 {index + 1} 关
        </span>
      </div>

      <div className="play-body">
        {questions.length === 0 && (
          <div className="empty-card">
            <p>这节课还没有题目，先在 courses/{course.name}.md 里补充吧</p>
            <button className="btn ghost" onClick={onExit}>
              回到地图
            </button>
          </div>
        )}

        {dialogue && (
          <section className="phase">
            <div className="prompt">
              <span className="prompt-eyebrow">对话练习</span>
              <h2>{dialogue.ask === "reply" ? "请你写出回答" : "请你写出问句"}</h2>
            </div>

            <div className="dialogue-card">
              <div className="dialogue-bubble">
                <span className="bubble-tag">
                  {dialogue.ask === "reply" ? "对方说" : "对方问"}
                </span>
                <p>{dialogue.shown}</p>
                <button
                  className="speak-btn small"
                  aria-label="朗读这句话"
                  onClick={() => {
                    sfx.tap();
                    speak(dialogue.shown);
                  }}
                >
                  <SpeakerIcon size={20} />
                </button>
              </div>

              <form className="answer-form" onSubmit={submitAnswer}>
                <input
                  ref={inputRef}
                  className={`answer-input ${inputState}`}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    if (inputState === "wrong") setInputState("idle");
                  }}
                  disabled={inputState === "correct"}
                  placeholder={
                    dialogue.ask === "reply" ? "输入回答的英文…" : "输入问句的英文…"
                  }
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <button
                  className="btn primary"
                  type="submit"
                  disabled={!input.trim() || inputState === "correct"}
                >
                  确定
                </button>
              </form>

              <div className="answer-meta">
                <span className="answer-tip">
                  要和答案一模一样，大小写和标点也要一致
                </span>
                {inputState === "wrong" && (
                  <span className="answer-error">再试一次，仔细看看句子哦</span>
                )}
                {inputState === "correct" && (
                  <span className="answer-success">
                    <CheckIcon size={12} /> 答对啦
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {phrase && (
          <section className="phase">
            <div className="prompt">
              <span className="prompt-eyebrow">短语练习</span>
              <h2>看图选出正确的短语</h2>
            </div>

            <div className="phrase-card">
              <div className={`phrase-image ${phrase.image ? "" : "placeholder"}`}>
                {phrase.image ? (
                  <img src={phrase.image} alt="题目图片" draggable={false} />
                ) : (
                  <span>图片准备中</span>
                )}
              </div>

              <div className="word-grid phrase-grid">
                {phrase.options.map((option, i) => {
                  const isCorrect = pickedPhrase === option;
                  return (
                    <button
                      key={option}
                      className={`word-option ${isCorrect ? "correct" : ""} ${
                        wrongIds.includes(option) ? "wrong" : ""
                      } ${shakeId === option ? "shake" : ""}`}
                      onClick={() => choosePhrase(option)}
                      disabled={isCorrect || wrongIds.includes(option)}
                    >
                      <RainbowText text={option} offset={i * 2} />
                      {isCorrect && (
                        <span className="option-check">
                          <CheckIcon size={16} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="phrase-footer">
                答对全部 {questions.length} 道题才能完成本关
              </p>
            </div>
          </section>
        )}
      </div>

      {finished && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="通关成功">
          <Confetti />
          <div className="success-card">
            <div className="success-img">
              <img src={course.thumb} alt="" draggable={false} />
            </div>
            <div className="success-stars" aria-hidden="true">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={`big-star ${n <= stars ? "on" : ""}`}
                  style={{ animationDelay: `${0.15 + n * 0.12}s` }}
                >
                  {n <= stars ? "★" : "☆"}
                </span>
              ))}
            </div>
            <h2 className="success-title">
              <RainbowText text="Great job!" />
            </h2>
            <p className="success-text">
              你答对了第 {index + 1} 关的全部 {questions.length} 道题
            </p>
            <div className="success-actions">
              <button className="btn ghost" onClick={onExit}>
                回到地图
              </button>
              {index + 1 < COURSES.length && (
                <button className="btn primary" onClick={() => onNext(index + 1)}>
                  下一关
                </button>
              )}
            </div>
            {index + 1 < COURSES.length && (
              <p className="success-unlock">下一关已经点亮啦</p>
            )}
            {index + 1 === COURSES.length && (
              <p className="success-unlock">这是最后一关，全部完成！</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
