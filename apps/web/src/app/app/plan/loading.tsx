import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

/**
 * `/app/plan` loading skeleton — header bar (eyebrow + H1 + progress
 * + meta) + controls row (Timeline/Month toggle, Show: All/Strength/
 * Cardio) + a 4×7 timeline grid frame + a 7-row "this week" rail.
 * Mirrors `PlanRedesign`'s layout so the live page doesn't shift on
 * paint.
 */
export default function PlanLoading() {
  return (
    <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header bar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton w={100} h={12} />
        <Skeleton w={260} h={28} r={8} />
        <Skeleton w="60%" h={8} r={999} />
        <div style={{ display: "flex", gap: 10 }}>
          <Skeleton w={120} h={12} />
          <Skeleton w={140} h={12} />
          <Skeleton w={100} h={12} />
        </div>
      </div>

      {/* Controls row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 4, border: "1px solid var(--cp-border)", borderRadius: 10 }}>
          <Skeleton w={80} h={32} r={6} />
          <Skeleton w={80} h={32} r={6} />
        </div>
        <div style={{ display: "flex", gap: 4, padding: 4, border: "1px solid var(--cp-border)", borderRadius: 10 }}>
          <Skeleton w={56} h={32} r={6} />
          <Skeleton w={80} h={32} r={6} />
          <Skeleton w={68} h={32} r={6} />
        </div>
      </div>

      {/* Main grid: timeline (4×7) + rail (7 rows) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 280px",
          gap: 16,
        }}
      >
        {/* 4×7 timeline frame */}
        <SkeletonCard h={460} padding={12}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 8,
              flex: 1,
            }}
          >
            {Array.from({ length: 28 }).map((_, i) => (
              <Skeleton key={i} h="100%" r={8} style={{ minHeight: 90 }} />
            ))}
          </div>
        </SkeletonCard>

        {/* Rail card — 7 stacked rows */}
        <SkeletonCard h={460} padding={12}>
          <Skeleton w={140} h={14} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} h={44} r={8} />
            ))}
          </div>
        </SkeletonCard>
      </div>
    </div>
  );
}
