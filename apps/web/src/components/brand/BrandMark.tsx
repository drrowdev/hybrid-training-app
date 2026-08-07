type BrandMarkProps = {
  size?: number;
};

export function BrandMark({ size = 32 }: BrandMarkProps) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        border: `${Math.max(1.5, size / 24)}px solid var(--cp-accent)`,
        borderRadius: Math.max(3, size / 10),
        transform: "rotate(45deg)",
        display: "grid",
        placeItems: "center",
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          transform: "rotate(-45deg)",
          fontFamily: "var(--cp-font-mono)",
          fontWeight: 700,
          fontSize: size * 0.36,
          lineHeight: 1,
          color: "var(--cp-text)",
        }}
      >
        S<span style={{ color: "var(--cp-accent)" }}>×</span>C
      </span>
    </span>
  );
}
