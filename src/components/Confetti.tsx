import { useMemo } from "react";
import { RAINBOW } from "../game/theme";

const SHAPES = ["confetti-dot", "confetti-bar", "confetti-star"];

export default function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 46 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.2 + Math.random() * 1.6,
        size: 8 + Math.random() * 10,
        rotate: Math.random() * 360,
        color: RAINBOW[i % RAINBOW.length],
        shape: SHAPES[i % SHAPES.length],
      })),
    [],
  );

  return (
    <div className="confetti-layer" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`confetti-piece ${p.shape}`}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.shape === "confetti-bar" ? p.size * 1.8 : p.size,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
