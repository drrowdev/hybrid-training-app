import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

/**
 * Stats segment fallback — applies to `/app/stats` and any child route
 * without its own `loading.tsx`. Sibling routes (wellness, adherence)
 * ship more shape-specific skeletons; this one covers `/app/stats`
 * itself and other stats children with a generic chart-card frame so
 * the user still gets an instant paint.
 */
export default function StatsLoading() {
  return (
    <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w={80} h={12} />
        <Skeleton w={200} h={26} r={8} />
      </div>

      {/* Range chip row */}
      <div style={{ display: "flex", gap: 8 }}>
        <Skeleton w={56} h={28} r={999} />
        <Skeleton w={56} h={28} r={999} />
        <Skeleton w={56} h={28} r={999} />
      </div>

      {/* 3 chart cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} h={220}>
            <Skeleton w={140} h={14} />
            <Skeleton w={80} h={22} r={8} />
            <Skeleton h="100%" r={8} style={{ minHeight: 120, marginTop: "auto" }} />
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
