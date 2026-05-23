/**
 * WeekDotsCard — 7-day strip for the Today right rail.
 *
 * Each day in the current ISO week is one of:
 *   - filled accent  → strength session completed
 *   - filled blue    → cardio session completed
 *   - half           → both completed
 *   - hollow-dashed  → planned but not yet done
 *   - hollow         → nothing planned, nothing done
 *
 * Today is highlighted with an outer ring. The card is a pure render —
 * the parent computes the day buckets and the "X done" counter.
 */

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export type WeekDayCell = {
  strengthDone: boolean;
  cardioDone: boolean;
  planned: boolean;
  isToday: boolean;
};

export function WeekDotsCard({
  days,
  doneCount,
}: {
  days: WeekDayCell[]; // length 7, Mon..Sun
  doneCount: number;
}) {
  return (
    <section
      className="cp-card"
      style={{ padding: 18 }}
      aria-label="This week's training activity"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>This week</h4>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          {doneCount} done
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          textAlign: "center",
        }}
      >
        {DAY_LABELS.map((d, i) => (
          <div
            key={`l${i}`}
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              fontWeight: 600,
            }}
          >
            {d}
          </div>
        ))}
        {days.map((cell, i) => (
          <div
            key={`d${i}`}
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: 6,
            }}
          >
            <Dot cell={cell} />
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          gap: 10,
          fontSize: 11,
          color: "var(--cp-text-muted)",
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        <Legend label="Strength" background="var(--cp-accent)" />
        <Legend label="Cardio" background="var(--cp-link)" />
        <Legend
          label="Planned"
          background="transparent"
          dashed
        />
      </div>
    </section>
  );
}

function Dot({ cell }: { cell: WeekDayCell }) {
  const both = cell.strengthDone && cell.cardioDone;
  const ring = cell.isToday
    ? { boxShadow: "0 0 0 2px var(--cp-accent)" }
    : {};
  const baseStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 600,
    ...ring,
  };
  if (both) {
    return (
      <div
        title="Strength + Cardio"
        style={{
          ...baseStyle,
          background:
            "linear-gradient(90deg, var(--cp-accent) 0 50%, var(--cp-link) 50% 100%)",
          color: "#fff",
        }}
      >
        SC
      </div>
    );
  }
  if (cell.strengthDone) {
    return (
      <div
        title="Strength"
        style={{
          ...baseStyle,
          background: "var(--cp-accent)",
          color: "var(--cp-accent-fg, #fff)",
        }}
      >
        S
      </div>
    );
  }
  if (cell.cardioDone) {
    return (
      <div
        title="Cardio"
        style={{
          ...baseStyle,
          background: "var(--cp-link)",
          color: "#fff",
        }}
      >
        C
      </div>
    );
  }
  if (cell.planned) {
    return (
      <div
        title="Planned"
        style={{
          ...baseStyle,
          background: "transparent",
          border: "1.5px dashed var(--cp-border-strong, var(--cp-border))",
          color: "var(--cp-text-muted)",
        }}
      >
        ·
      </div>
    );
  }
  return (
    <div
      style={{
        ...baseStyle,
        background: "transparent",
        color: "var(--cp-text-muted)",
      }}
    >
      –
    </div>
  );
}

function Legend({
  label,
  background,
  dashed,
}: {
  label: string;
  background: string;
  dashed?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background,
          border: dashed
            ? "1px dashed var(--cp-border-strong, var(--cp-border))"
            : "none",
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
