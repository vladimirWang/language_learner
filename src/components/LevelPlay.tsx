import { useEffect, useMemo, useRef, useState } from "react";
import { LEVELS, type Level } from "../game/levels";
import { sfx, speak } from "../game/audio";
import RainbowText from "./RainbowText";
import Confetti from "./Confetti";
import { ArrowLeftIcon, CheckIcon, SpeakerIcon } from "./icons";

type Phase = "study" | "pic" | "word";

type Props = {
  index: number;
  onExit: () => void;
  onComplete: (index: number, stars: number) => void;
  onNext: (index: number) => void;
};

const STEPS: { key: Phase; label: string }[] = [
  { key: "study", label: "学一学" },
  { key: "pic", label: "选图片" },
  { key: "word", label: "选单词" },
];

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function LevelPlay({ index, onExit, onComplete, onNext }: Props) {
  const level = LEVELS[index];
  const [phase, setPhase] = useState<Phase>("study");
  const [mistakes, setMistakes] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [shakeId, setShakeId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [stars, setStars] = useState(0);
  const timers = useRef<number[]>([]);

  const options = useMemo(() => {
    const distractors = shuffle(LEVELS.filter((item) => item.id !== level.id)).slice(0, 3);
    return shuffle([level, ...distractors]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const later = (fn: () => void, delay: number) => {
    const id = window.setTimeout(fn, delay);
    timers.current.push(id);
  };

  useEffect(() => {
    const id = window.setTimeout(() => speak(level.word), 400);
    timers.current.push(id);
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stepIndex = phase === "study" ? 0 : phase === "pic" ? 1 : 2;

  const startChallenge = () => {
    sfx.tap();
    setPhase("pic");
    speak(level.word);
  };

  const choose = (option: Level) => {
    if (finished || pickedId) return;

    if (option.id !== level.id) {
      setMistakes((n) => n + 1);
      setWrongIds((ids) => (ids.includes(option.id) ? ids : [...ids, option.id]));
      setShakeId(option.id);
      sfx.wrong();
      later(() => setShakeId(null), 450);
      return;
    }

    setPickedId(option.id);
    sfx.correct();
    later(() => {
      if (phase === "pic") {
        setPhase("word");
        setPickedId(null);
        setWrongIds([]);
        speak(level.word);
        return;
      }
      const earned = mistakes === 0 ? 3 : mistakes === 1 ? 2 : 1;
      setStars(earned);
      setFinished(true);
      sfx.win();
      speak(level.word);
      onComplete(index, earned);
    }, 820);
  };

  const optionClass = (id: string) => {
    if (pickedId === id) return "correct";
    if (wrongIds.includes(id)) return "wrong";
    return "";
  };

  return (
    <div className="play-screen">
      <div className="play-topbar">
        <button className="back-btn" onClick={onExit}>
          <ArrowLeftIcon size={18} />
          地图
        </button>
        <div className="step-track">
          {STEPS.map((step, i) => (
            <span
              key={step.key}
              className={`step-pill ${i === stepIndex ? "active" : ""} ${i < stepIndex ? "done" : ""}`}
            >
              <span className="step-dot">
                {i < stepIndex ? <CheckIcon size={10} /> : i + 1}
              </span>
              {step.label}
            </span>
          ))}
        </div>
        <span className="level-chip" style={{ background: level.accent }}>
          第 {index + 1} 关
        </span>
      </div>

      <div className="play-body">
        {phase === "study" && (
          <section className="phase">
            <div className="prompt">
              <span className="prompt-eyebrow">学一学</span>
              <h2>看看图片，读出这个单词</h2>
            </div>
            <div className="study-card">
              <div className="study-image">
                <img src={level.thumb} alt={level.zh} draggable={false} />
              </div>
              <div className="study-info">
                <div className="study-word-row">
                  <RainbowText
                    text={level.word}
                    className="study-word"
                    offset={index * 2}
                  />
                  <button
                    className="speak-btn"
                    aria-label="朗读单词"
                    onClick={() => {
                      sfx.tap();
                      speak(level.word);
                    }}
                  >
                    <SpeakerIcon size={26} />
                  </button>
                </div>
                <p className="study-zh">{level.zh}</p>
                <p className="study-tip">{level.tip}</p>
                <button className="btn primary" onClick={startChallenge}>
                  开始挑战
                </button>
              </div>
            </div>
          </section>
        )}

        {phase === "pic" && (
          <section className="phase">
            <div className="prompt">
              <span className="prompt-eyebrow">选一选</span>
              <h2>
                哪张图片是
                <RainbowText
                  text={level.word}
                  className="inline-word"
                  offset={index * 2}
                />
                ？
              </h2>
            </div>
            <div className="option-grid">
              {options.map((option) => (
                <button
                  key={option.id}
                  className={`pic-option ${optionClass(option.id)} ${shakeId === option.id ? "shake" : ""}`}
                  onClick={() => choose(option)}
                  disabled={pickedId === option.id || wrongIds.includes(option.id)}
                  aria-label={option.zh}
                >
                  <span className="pic-option-img">
                    <img src={option.thumb} alt="" draggable={false} />
                  </span>
                  {pickedId === option.id && (
                    <span className="option-check">
                      <CheckIcon size={16} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {phase === "word" && (
          <section className="phase">
            <div className="prompt">
              <span className="prompt-eyebrow">选一选</span>
              <h2>这张图片的单词是什么？</h2>
            </div>
            <div className="word-question">
              <div className="word-question-img">
                <img src={level.thumb} alt={level.zh} draggable={false} />
              </div>
              <button
                className="speak-btn"
                aria-label="朗读单词"
                onClick={() => {
                  sfx.tap();
                  speak(level.word);
                }}
              >
                <SpeakerIcon size={24} />
              </button>
            </div>
            {mistakes > 0 && <p className="hint">提示：{level.zh}</p>}
            <div className="word-grid">
              {options.map((option, i) => (
                <button
                  key={option.id}
                  className={`word-option ${optionClass(option.id)} ${shakeId === option.id ? "shake" : ""}`}
                  onClick={() => choose(option)}
                  disabled={pickedId === option.id || wrongIds.includes(option.id)}
                >
                  <RainbowText text={option.word} offset={i * 2} />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {finished && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="通关成功">
          <Confetti />
          <div className="success-card">
            <div className="success-img">
              <img src={level.thumb} alt="" draggable={false} />
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
              你学会了 <b>{level.word}</b> · {level.zh}
            </p>
            <div className="success-actions">
              <button className="btn ghost" onClick={onExit}>
                回到地图
              </button>
              {index + 1 < LEVELS.length && (
                <button className="btn primary" onClick={() => onNext(index + 1)}>
                  下一关
                </button>
              )}
            </div>
            {index + 1 < LEVELS.length && (
              <p className="success-unlock">下一关已经点亮啦</p>
            )}
            {index + 1 === LEVELS.length && (
              <p className="success-unlock">这是最后一关，全部完成！</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
