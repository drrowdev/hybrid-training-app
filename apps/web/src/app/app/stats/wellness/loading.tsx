import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

/**
 * `/app/stats/wellness` loading skeleton — range chip row + ~4 chart
 * cards laid out in the same responsive grid as the live page
 * (bodyweight, fatigue, soreness, motivation). 1595ms RSC warm in the
 * audit, so this is one of the higher-impact skeletons.
 */
export default function WellnessLoading() {
  return (
    <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w={80} h={12} />
        <Skeleton w={220} h={26} r={8} />
      </div>

      {/* Range chips */}
      <div style={{ display: "flex", gap: 8 }}>
        <Skeleton w={56} h={28} r={999} />
        <Skeleton w={56} h={28} r={999} />
        <Skeleton w={56} h={28} r={999} />
      </div>

      {/* Chart card grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} h={240}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Skeleton w={140} h={14} />
              <Skeleton w={48} h={12} />
            </div>
            <Skeleton w={100} h={28} r={8} />
            <Skeleton h="100%" r={8} style={{ minHeight: 140, marginTop: "auto" }} />
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
