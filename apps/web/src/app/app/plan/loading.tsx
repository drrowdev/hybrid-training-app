import { Skeleton, SkeletonCard } from "@/components/skeleton/Skeleton";

/**
 * Mirrors the redesigned Plan hierarchy: program identity and actions, compact
 * Program / Calendar switch, then one full-width phase with the current week
 * expanded into readable agenda rows.
 */
export default function PlanLoading() {
  return (
    <div
      style={{
        padding: "16px 0",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 14,
          paddingBottom: 20,
          borderBottom: "1px solid var(--cp-border)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <Skeleton w={180} h={12} />
            <Skeleton w={260} h={38} r={8} />
            <Skeleton w={280} h={14} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Skeleton w={112} h={44} r={10} />
            <Skeleton w={76} h={44} r={10} />
            <Skeleton w={44} h={44} r={10} />
          </div>
        </div>
        <Skeleton w="100%" h={7} r={999} />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 4,
            border: "1px solid var(--cp-border)",
            borderRadius: 10,
          }}
        >
          <Skeleton w={80} h={32} r={6} />
          <Skeleton w={80} h={32} r={6} />
        </div>
        <Skeleton w={220} h={12} />
      </div>

      <SkeletonCard h={520} padding={0}>
        <div style={{ display: "grid", gap: 0, flex: 1 }}>
          <div
            style={{
              padding: 16,
              borderBottom: "1px solid var(--cp-border)",
            }}
          >
            <Skeleton w={180} h={18} />
            <Skeleton w={260} h={12} style={{ marginTop: 6 }} />
          </div>
          <Skeleton h={72} r={0} />
          <div
            style={{
              padding: 14,
              background: "var(--cp-accent-soft)",
            }}
          >
            <Skeleton h={72} r={0} />
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 8,
                marginTop: 12,
              }}
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} h={76} r={8} />
              ))}
            </div>
          </div>
          <Skeleton h={72} r={0} />
        </div>
      </SkeletonCard>
    </div>
  );
}
