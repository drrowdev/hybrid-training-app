/**
 * Skeleton — tiny presentational primitive used by route-level
 * `loading.tsx` files to paint placeholder blocks while a server
 * component is fetching. Server-renderable (no client hooks), styled
 * with the same `--cp-*` tokens as the live UI so light/dark themes
 * match without any extra wiring. The pulse keyframes live in
 * `apps/web/src/app/globals.css` as `cp-skel-pulse`.
 */
export function Skeleton({
  w,
  h,
  r = 6,
  className,
  style,
}: {
  w?: string | number;
  h?: string | number;
  r?: number | string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        width: w,
        height: h,
        borderRadius: r,
        background: "var(--cp-border)",
        opacity: 0.55,
        animation: "cp-skel-pulse 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/**
 * SkeletonCard — a `cp-card`-shaped frame for chart/panel placeholders
 * so the chrome (border + radius + shadow) matches the real card and
 * only the inner content fades in.
 */
export function SkeletonCard({
  h,
  children,
  padding = 16,
  style,
}: {
  h?: string | number;
  children?: React.ReactNode;
  padding?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className="cp-card"
      style={{
        height: h,
        padding,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
