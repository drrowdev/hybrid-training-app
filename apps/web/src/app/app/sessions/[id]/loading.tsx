import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

/**
 * `/app/sessions/[id]` loading skeleton — session header + ~3
 * placeholder set rows + a "next set" / complete button area. Keeps
 * the sticky-bottom bar's vertical reservation so the page doesn't
 * jump when the real controls mount.
 */
export default function SessionLoading() {
  return (
    <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w={100} h={12} />
        <Skeleton w={240} h={26} r={8} />
        <div style={{ display: "flex", gap: 8 }}>
          <Skeleton w={70} h={20} r={999} />
          <Skeleton w={90} h={20} r={999} />
          <Skeleton w={60} h={20} r={999} />
        </div>
      </div>

      {/* Movement card with set rows */}
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

      {/* Secondary movement / notes card */}
      <SkeletonCard h={140}>
        <Skeleton w={160} h={14} />
        <Skeleton h={12} />
        <Skeleton w="80%" h={12} />
        <Skeleton w="60%" h={12} />
      </SkeletonCard>

      {/* Sticky next-set button area */}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Skeleton h={48} r={10} style={{ flex: 1 }} />
        <Skeleton w={120} h={48} r={10} />
      </div>
    </div>
  );
}
