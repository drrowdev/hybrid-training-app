import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--cp-bg)",
        color: "var(--cp-text)",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 32,
          justifyItems: "center",
          textAlign: "center",
        }}
      >
        <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
          <div
            aria-label="SxC"
            style={{
              fontFamily: "var(--font-brand), system-ui, sans-serif",
              fontWeight: 700,
              fontSize: "clamp(64px, 18vw, 104px)",
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          >
            S
            <span style={{ color: "var(--cp-accent)", margin: "0 2px" }}>×</span>
            C
          </div>
          <div
            style={{
              fontFamily: "var(--cp-font-mono)",
              fontWeight: 500,
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.28em",
              color: "var(--cp-text-muted)",
            }}
          >
            Strength <span style={{ color: "var(--cp-accent)" }}>×</span> Cardio
          </div>
        </div>

        <Link
          href="/login"
          className="cp-btn primary big"
          style={{ minWidth: 200, justifyContent: "center" }}
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
