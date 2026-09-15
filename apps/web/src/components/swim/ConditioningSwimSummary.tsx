import Link from "next/link";
import { conditioningSwimHref, SWIM_TRAINING_LABEL, type ConditioningSwim, type SwimOrigin } from "@/lib/swim/conditioning-presentation";

export function ConditioningSwimSummary({ swim, origin }: { swim: ConditioningSwim; origin: SwimOrigin }) {
  return <div data-testid="conditioning-swim-summary" style={{ display: "grid", gap: 16 }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12 }}>
      <strong style={{ fontSize: 24 }}>{swim.distance}</strong>
      <span style={{ color: "var(--cp-text-muted)" }}>{swim.pool}</span>
    </div>
    {swim.status !== "scheduled" && <span>{SWIM_TRAINING_LABEL[swim.status]}</span>}
    <Link className="cp-btn primary" href={conditioningSwimHref(swim.id, origin)} style={{ justifySelf: "start" }}>
      View swim
    </Link>
  </div>;
}
