import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

/**
 * `/app/settings/training-maxes` loading skeleton — header + a form
 * card with 6 label/input rows mirroring the TmSection layout. 1276ms
 * RSC warm in the audit.
 */
export default function TrainingMaxesLoading() {
  return (
    <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w={120} h={12} />
        <Skeleton w={240} h={26} r={8} />
        <Skeleton w="70%" h={12} />
      </div>

      {/* Default-% row */}
      <SkeletonCard h={84}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton w={120} h={14} />
            <Skeleton w={200} h={10} />
          </div>
          <Skeleton w={120} h={40} r={10} />
        </div>
      </SkeletonCard>

      {/* Training-max form rows */}
      <SkeletonCard h={420} padding={16}>
        <Skeleton w={160} h={14} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 1fr) minmax(0, 1.4fr) 88px",
                gap: 12,
                alignItems: "center",
              }}
            >
              <Skeleton w="80%" h={14} />
              <Skeleton h={40} r={10} />
              <Skeleton h={40} r={10} />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}
