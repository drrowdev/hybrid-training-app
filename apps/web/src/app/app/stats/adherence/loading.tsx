import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

/**
 * `/app/stats/adherence` loading skeleton — range chip row + 2–3 chart
 * card frames matching the live adherence dashboard layout. 1440ms
 * RSC warm in the audit.
 */
export default function AdherenceLoading() {
  return (
    <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w={80} h={12} />
        <Skeleton w={200} h={26} r={8} />
      </div>

      {/* Range chips */}
      <div style={{ display: "flex", gap: 8 }}>
        <Skeleton w={56} h={28} r={999} />
        <Skeleton w={56} h={28} r={999} />
        <Skeleton w={56} h={28} r={999} />
      </div>

      {/* Summary stat strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} h={96}>
            <Skeleton w={80} h={12} />
            <Skeleton w={64} h={24} r={8} />
          </SkeletonCard>
        ))}
      </div>

      {/* 2 chart cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonCard key={i} h={260}>
            <Skeleton w={160} h={14} />
            <Skeleton h="100%" r={8} style={{ minHeight: 180, marginTop: "auto" }} />
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
