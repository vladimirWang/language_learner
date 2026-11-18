import type { ExamAid } from "../game/examBlueprint";

/** 考试辅助材料面板：关键词、题卡、思维导图、双人日程。 */
export default function ExamAidPanel({ aid }: { aid: ExamAid }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        padding: "12px 16px",
        marginBottom: 12,
        boxShadow: "0 8px 20px rgba(160,125,85,.10)",
      }}
    >
      <div style={{ fontSize: 12, color: "#8a7d6b", marginBottom: 8 }}>{aid.label}</div>

      {aid.kind === "chips" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {aid.items.map((item) => (
            <span
              key={item}
              style={{
                background: "#F1ECFF",
                color: "#5B3FA8",
                borderRadius: 999,
                padding: "4px 12px",
                fontSize: 13,
              }}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {aid.kind === "cards" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
          }}
        >
          {aid.cards.map((card) => (
            <div
              key={card.title}
              style={{
                border: "1px solid #E6DCCB",
                borderRadius: 10,
                padding: "10px 12px",
                background: "#FFFDF8",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "#5B3FA8" }}>{card.title}</div>
              <div style={{ fontSize: 12, color: "#8a7d6b", marginTop: 2 }}>{card.hint}</div>
            </div>
          ))}
        </div>
      )}

      {aid.kind === "mindmap" && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div
            style={{
              background: "#7C5CBF",
              color: "#fff",
              borderRadius: 999,
              padding: "10px 18px",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            {aid.center}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {aid.branches.map((branch) => (
              <span
                key={branch}
                style={{
                  border: "1px dashed #C9B8F0",
                  color: "#5B3FA8",
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: 13,
                }}
              >
                {branch}
              </span>
            ))}
          </div>
        </div>
      )}

      {aid.kind === "schedule" && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {aid.groups.map((group) => (
            <div
              key={group.name}
              style={{
                flex: "1 1 180px",
                border: "1px solid #E6DCCB",
                borderRadius: 10,
                padding: "10px 12px",
                background: "#FFFDF8",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{group.name}</div>
              {group.slots.map((slot) => (
                <div
                  key={slot}
                  style={{
                    fontSize: 12,
                    color: "#6b6156",
                    background: "#F7F3FF",
                    borderRadius: 6,
                    padding: "3px 8px",
                    marginBottom: 4,
                  }}
                >
                  {slot}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {aid.kind === "topic" && (
        <span
          style={{
            background: "#F1ECFF",
            color: "#5B3FA8",
            borderRadius: 999,
            padding: "4px 12px",
            fontSize: 13,
          }}
        >
          {aid.text}
        </span>
      )}
    </div>
  );
}
