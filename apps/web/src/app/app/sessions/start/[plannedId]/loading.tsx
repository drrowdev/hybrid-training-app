/**
 * `/app/sessions/start/[plannedId]` loading skeleton.
 *
 * This route is a trampoline: it materialises the planned session server-side
 * and `redirect()`s to `/app/sessions/[id]`. Without a loading boundary the
 * Today page froze during that server work, so tapping "Start workout" felt
 * unresponsive for a second or two. This skeleton shows instantly on tap — a
 * brief "Starting your workout…" state — and mirrors the session log skeleton
 * so the hand-off to the real session page is visually seamless.
 */
import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

export default function StartSessionLoading() {
  return (
    <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w={140} h={12} />
        <Skeleton w={240} h={26} r={8} />
        <div
          style={{ fontSize: 13, color: "var(--cp-text-muted)", marginTop: 2 }}
          aria-live="polite"
        >
          Starting your workout…
        </div>
      </div>

      <SkeletonCard h={260} padding={16}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Skeleton w={160} h={16} />
          <Skeleton w={72} h={16} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "32px 1fr 1fr 1fr",
                gap: 10,
                alignItems: "center",
              }}
            >
              <Skeleton w={24} h={14} />
              <Skeleton h={36} r={8} />
              <Skeleton h={36} r={8} />
              <Skeleton h={36} r={8} />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}
