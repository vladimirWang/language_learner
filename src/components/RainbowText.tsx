import { RAINBOW } from "../game/theme";

type Props = {
  text: string;
  className?: string;
  /** 起始配色偏移，让每个关卡的字母配色不同 */
  offset?: number;
};

export default function RainbowText({ text, className, offset = 0 }: Props) {
  return (
    <span
      className={["rainbow-text", className].filter(Boolean).join(" ")}
      aria-label={text}
    >
      {Array.from(text).map((char, i) =>
        char === " " ? (
          <span key={i} className="rainbow-space" />
        ) : (
          <span
            key={i}
            className="rainbow-letter"
            style={{ color: RAINBOW[(i + offset) % RAINBOW.length] }}
          >
            {char}
          </span>
        ),
      )}
    </span>
  );
}
