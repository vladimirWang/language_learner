import { useEffect, useRef } from "react";
import { LEVELS } from "../game/levels";
import type { Progress } from "../game/progress";
import { totalStars } from "../game/progress";
import RainbowText from "./RainbowText";
import { CheckIcon, LockIcon, SparkleIcon, TrophyIcon } from "./icons";
import { sfx } from "../game/audio";

const MAP_WIDTH = 920;
const MAP_HEIGHT = 1470;

const NODE_POINTS = [
  { x: 455, y: 150 },
  { x: 280, y: 306 },
  { x: 420, y: 462 },
  { x: 632, y: 618 },
  { x: 478, y: 774 },
  { x: 286, y: 930 },
  { x: 470, y: 1086 },
  { x: 676, y: 1242 },
];

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
  onReset: () => void;
};

export default function MapScreen({ progress, freshIndex, onSelect, onReset }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const target = nodeRefs.current[freshIndex ?? progress.unlocked];
    target?.scrollIntoView({
      block: "center",
      behavior: freshIndex === null ? "auto" : "smooth",
    });
    // 只在进入地图时定位一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const litCount = Math.min(LEVELS.length, progress.unlocked + 1);
  const allDone = Object.keys(progress.stars).length === LEVELS.length;

  const handleSelect = (index: number) => {
    if (index > progress.unlocked) return;
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
          <div className="star-pill" title="已收集的星星">
            <span className="star-glyph">★</span>
            <span>
              {totalStars(progress)} <i>/ {LEVELS.length * 3}</i>
            </span>
          </div>
          <button className="reset-btn" onClick={onReset}>
            重置进度
          </button>
        </div>
      </header>

      <div className="map-viewport" ref={viewportRef}>
        <div className="map-canvas" style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}>
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
            height={MAP_HEIGHT}
            viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
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
              d={smoothPath(NODE_POINTS)}
              fill="none"
              stroke="#EBDFCB"
              strokeWidth="13"
              strokeLinecap="round"
              strokeDasharray="2 22"
            />
            {progress.unlocked > 0 && (
              <path
                d={smoothPath(NODE_POINTS.slice(0, Math.min(progress.unlocked + 1, NODE_POINTS.length)))}
                fill="none"
                stroke="url(#roadGradient)"
                strokeWidth="9"
                strokeLinecap="round"
              />
            )}
          </svg>

          {LEVELS.map((level, index) => {
            const earned = progress.stars[level.id] ?? 0;
            const state =
              index > progress.unlocked
                ? "locked"
                : earned > 0
                  ? "completed"
                  : "current";
            return (
              <button
                key={level.id}
                ref={(el) => {
                  nodeRefs.current[index] = el;
                }}
                className={`map-node ${state} ${freshIndex === index ? "fresh" : ""}`}
                style={{
                  left: NODE_POINTS[index].x,
                  top: NODE_POINTS[index].y,
                  ["--accent" as string]: level.accent,
                }}
                onClick={() => handleSelect(index)}
                disabled={state === "locked"}
                aria-label={`第 ${index + 1} 关：${level.word}（${level.zh}）`}
              >
                {state === "current" && (
                  <span className="node-bubble">
                    {freshIndex === index ? "新关卡" : "GO!"}
                  </span>
                )}
                <span className="node-orb-wrap">
                  {state === "current" && <span className="node-halo" />}
                  <span className="node-orb">
                    <img src={level.thumb} alt="" draggable={false} />
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
                  <RainbowText text={level.word} offset={index * 2} />
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
                    {state === "locked" ? "未解锁" : level.zh}
                  </span>
                )}
              </button>
            );
          })}

          <div className={`map-finish ${allDone ? "all-done" : ""}`}>
            <span className="finish-badge">
              <TrophyIcon size={32} />
            </span>
            <div>
              <p className="finish-title">
                {allDone ? "全部通关，太厉害啦！" : `已点亮 ${litCount} / ${LEVELS.length} 关`}
              </p>
              <p className="finish-sub">
                {allDone ? "8 个单词都被你收进小脑袋啦" : "继续往前走，闯过一关就点亮一个单词"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
