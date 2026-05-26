import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

/**
 * `/app` (Today) loading skeleton — mirrors the Today page chrome so
 * navigation paints instantly and only the live data sections pop in.
 * Shape: eyebrow date + H1 + week-strip + how-recovered card + main
 * "next session" hero + a secondary card row. Matches the audit's
 * worst-offender route (2053ms RSC warm).
 */
export default function TodayLoading() {
  return (
    <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Eyebrow + title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w={120} h={12} />
        <Skeleton w={220} h={28} r={8} />
      </div>

      {/* Week-strip: 7 day cells in a row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 8,
        }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonCard key={i} h={64} padding={10}>
            <Skeleton w={24} h={10} />
            <Skeleton w={32} h={14} />
          </SkeletonCard>
        ))}
      </div>

      {/* How-recovered prompt */}
      <SkeletonCard h={120} padding={16}>
        <Skeleton w={160} h={14} />
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} w={48} h={36} r={10} />
          ))}
        </div>
      </SkeletonCard>

      {/* Today hero — next session card */}
      <SkeletonCard h={220} padding={20}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Skeleton w={140} h={14} />
          <Skeleton w={64} h={20} r={999} />
        </div>
        <Skeleton w="70%" h={22} r={8} />
        <Skeleton w="40%" h={12} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <Skeleton h={14} />
          <Skeleton w="92%" h={14} />
          <Skeleton w="85%" h={14} />
        </div>
        <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
          <Skeleton w={140} h={44} r={10} />
          <Skeleton w={100} h={44} r={10} />
        </div>
      </SkeletonCard>

      {/* Secondary row — upcoming + freshness */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <SkeletonCard h={180}>
          <Skeleton w={120} h={14} />
          <Skeleton h={12} />
          <Skeleton w="80%" h={12} />
          <Skeleton w="70%" h={12} />
        </SkeletonCard>
        <SkeletonCard h={180}>
          <Skeleton w={120} h={14} />
          <Skeleton h={12} />
          <Skeleton w="80%" h={12} />
          <Skeleton w="70%" h={12} />
        </SkeletonCard>
      </div>
    </div>
  );
}
