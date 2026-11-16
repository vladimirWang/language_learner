import { useEffect, useRef } from "react";
import { COURSES, questionCount } from "../game/courses";
import type { Progress } from "../game/progress";
import { totalStars } from "../game/progress";
import RainbowText from "./RainbowText";
import MaterialUpdate from "./MaterialUpdate";
import { CheckIcon, LockIcon, SparkleIcon, TrophyIcon } from "./icons";
import { sfx } from "../game/audio";

const MAP_WIDTH = 920;

const X_PATTERN = [455, 280, 420, 632, 478, 286, 470, 676];

const FLOWERS = [
  { x: 112, y: 236, color: "#F2588E" },
  { x: 762, y: 356, color: "#FFC531" },
  { x: 148, y: 538, color: "#9B51E0" },
  { x: 796, y: 700, color: "#F2588E" },
  { x: 118, y: 856, color: "#2F86D6" },
  { x: 762, y: 1006, color: "#FF8A3D" },
  { x: 158, y: 1158, color: "#4FBF58" },
  { x: 792, y: 1298, color: "#1FB7C4" },
];

/** Catmull-Rom 转三次贝塞尔，让地图小路平滑蜿蜒 */
function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

type Props = {
  progress: Progress;
  freshIndex: number | null;
  onSelect: (index: number) => void;
  onOpenAgent: () => void;
  onReset: () => void;
};

export default function MapScreen({
  progress,
  freshIndex,
  onSelect,
  onOpenAgent,
  onReset,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const unlocked = Math.min(progress.unlocked, Math.max(0, COURSES.length - 1));
  const points = COURSES.map((_, index) => ({
    x: X_PATTERN[index % X_PATTERN.length],
    y: 150 + index * 156,
  }));
  const mapHeight = Math.max(
    660,
    (points.length ? points[points.length - 1].y : 0) + 230,
  );
  const litCount = Math.min(COURSES.length, unlocked + 1);
  const allDone =
    COURSES.length > 0 && COURSES.every((course) => (progress.stars[course.id] ?? 0) > 0);

  useEffect(() => {
    const target = nodeRefs.current[freshIndex ?? unlocked];
    target?.scrollIntoView({
      block: "center",
      behavior: freshIndex === null ? "auto" : "smooth",
    });
    // 只在进入地图时定位一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (index: number) => {
    if (index > unlocked) return;
    sfx.tap();
    onSelect(index);
  };

  return (
    <div className="map-screen">
      <header className="map-header">
        <div className="brand">
          <RainbowText text="Word Adventure" className="brand-title" />
          <p className="brand-sub">单词冒险 · 完成一关，下一关就会亮起来</p>
        </div>
        <div className="header-actions">
          <MaterialUpdate />
          <button className="agent-entry" onClick={onOpenAgent}>
            <SparkleIcon size={16} color="#fff" />
            Agent 练习
          </button>
          <div className="star-pill" title="已收集的星星">
            <span className="star-glyph">★</span>
            <span>
              {totalStars(progress)} <i>/ {COURSES.length * 3}</i>
            </span>
          </div>
          <button className="reset-btn" onClick={onReset}>
            重置进度
          </button>
        </div>
      </header>

      <div className="map-viewport" ref={viewportRef}>
        <div className="map-canvas" style={{ width: MAP_WIDTH, height: mapHeight }}>
          <div className="map-decor" aria-hidden="true">
            <span className="sun" />
            <span className="cloud cloud-1" />
            <span className="cloud cloud-2" />
            <span className="cloud cloud-3" />
            <span className="cloud cloud-4" />
            <span className="map-sparkle sp-1">
              <SparkleIcon size={26} color="#FFC531" />
            </span>
            <span className="map-sparkle sp-2">
              <SparkleIcon size={18} color="#F2588E" />
            </span>
            <span className="map-sparkle sp-3">
              <SparkleIcon size={21} color="#2F86D6" />
            </span>
            {FLOWERS.map((f, i) => (
              <svg
                key={i}
                className="map-flower"
                style={{ left: f.x, top: f.y }}
                width="34"
                height="34"
                viewBox="0 0 34 34"
              >
                {[0, 72, 144, 216, 288].map((deg) => (
                  <circle
                    key={deg}
                    cx={17 + 7 * Math.cos((deg * Math.PI) / 180)}
                    cy={17 + 7 * Math.sin((deg * Math.PI) / 180)}
                    r="6"
                    fill={f.color}
                    opacity="0.85"
                  />
                ))}
                <circle cx="17" cy="17" r="4.6" fill="#FFD65C" />
              </svg>
            ))}
            <svg
              className="map-hills"
              viewBox="0 0 920 340"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M0 140 C 150 60, 280 210, 460 150 C 640 90, 780 190, 920 120 L920 340 L0 340 Z"
                fill="#EDF7E7"
              />
              <path
                d="M0 214 C 180 132, 340 262, 540 200 C 700 150, 820 244, 920 190 L920 340 L0 340 Z"
                fill="#E0F2D8"
              />
              <path
                d="M0 276 C 220 230, 420 302, 620 262 C 760 234, 860 282, 920 262 L920 340 L0 340 Z"
                fill="#D2EDCB"
              />
            </svg>
          </div>

          <svg
            className="map-path"
            width={MAP_WIDTH}
            height={mapHeight}
            viewBox={`0 0 ${MAP_WIDTH} ${mapHeight}`}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="roadGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFC531" />
                <stop offset="50%" stopColor="#FF8A3D" />
                <stop offset="100%" stopColor="#4FBF58" />
              </linearGradient>
            </defs>
            <path
              d={smoothPath(points)}
              fill="none"
              stroke="#EBDFCB"
              strokeWidth="13"
              strokeLinecap="round"
              strokeDasharray="2 22"
            />
            {unlocked > 0 && (
              <path
                d={smoothPath(points.slice(0, Math.min(unlocked + 1, points.length)))}
                fill="none"
                stroke="url(#roadGradient)"
                strokeWidth="9"
                strokeLinecap="round"
              />
            )}
          </svg>

          {COURSES.map((course, index) => {
            const earned = progress.stars[course.id] ?? 0;
            const state =
              index > unlocked ? "locked" : earned > 0 ? "completed" : "current";
            return (
              <button
                key={course.id}
                ref={(el) => {
                  nodeRefs.current[index] = el;
                }}
                className={`map-node ${state} ${freshIndex === index ? "fresh" : ""}`}
                style={{
                  left: points[index].x,
                  top: points[index].y,
                  ["--accent" as string]: course.accent,
                }}
                onClick={() => handleSelect(index)}
                disabled={state === "locked"}
                aria-label={`第 ${index + 1} 关：${course.title}，共 ${questionCount(course)} 道题`}
              >
                {state === "current" && (
                  <span className="node-bubble">
                    {freshIndex === index ? "新关卡" : "GO!"}
                  </span>
                )}
                <span className="node-orb-wrap">
                  {state === "current" && <span className="node-halo" />}
                  <span className="node-orb">
                    <img src={course.thumb} alt="" draggable={false} />
                    <span className="node-number">{index + 1}</span>
                    {state === "locked" && (
                      <span className="node-lock">
                        <LockIcon size={30} />
                      </span>
                    )}
                    {state === "completed" && (
                      <span className="node-check">
                        <CheckIcon size={14} />
                      </span>
                    )}
                  </span>
                </span>
                <span className="node-label">
                  <RainbowText text={course.title} offset={index * 2} />
                </span>
                {state === "completed" ? (
                  <span className="node-stars" aria-label={`获得 ${earned} 颗星`}>
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={n <= earned ? "star on" : "star"}>
                        {n <= earned ? "★" : "☆"}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="node-zh">
                    {state === "locked"
                      ? "未解锁"
                      : `${course.dialogues.length} 对话 · ${course.phrases.length} 短语`}
                  </span>
                )}
              </button>
            );
          })}

          {COURSES.length === 0 && (
            <div className="map-empty">
              <p className="finish-title">courses 目录里还没有课程文件</p>
              <p className="finish-sub">新建一节课程（如 2.md）后重新运行即可开始</p>
            </div>
          )}

          <div className={`map-finish ${allDone ? "all-done" : ""}`}>
            <span className="finish-badge">
              <TrophyIcon size={32} />
            </span>
            <div>
              <p className="finish-title">
                {COURSES.length === 0
                  ? "等待新课程"
                  : allDone
                    ? "全部通关，太厉害啦！"
                    : `已点亮 ${litCount} / ${COURSES.length} 关`}
              </p>
              <p className="finish-sub">
                {allDone
                  ? `${COURSES.length} 节课程都被你收进小脑袋啦`
                  : "继续往前走，闯过一关就点亮下一节课程"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
