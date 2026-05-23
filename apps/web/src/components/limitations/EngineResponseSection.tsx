/**
 * EngineResponseSection — read-only summary of recent engine override
 * events. Server-rendered (no client interactivity beyond the
 * MetricHelp popover).
 *
 * Filters: last 14 days, current user. Until the engine writes the
 * "this override was caused by limitation X" link explicitly, we
 * surface every override in the window — the copy ("Recent
 * adjustments") is intentionally agnostic.
 */
import type { ReactElement } from "react";
import { MetricHelp } from "@/components/ui/MetricHelp";
import { EmptyState } from "@/components/ui/EmptyState";
import { describeEngineEvent, relativeFromNow } from "./utils";
import type { EngineEventRow } from "./types";

export type EngineResponseSectionProps = {
  events: EngineEventRow[];
  /** True if at least one limitation is active. Used in the empty copy. */
  hasActiveLimitation: boolean;
};

export function EngineResponseSection({
  events,
  hasActiveLimitation,
}: EngineResponseSectionProps): ReactElement {
  return (
    <section
      data-testid="engine-response-section"
      style={{ display: "grid", gap: 10 }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
          Recent adjustments
        </h2>
        <MetricHelp term="injury_aware_ceiling" />
      </header>
      <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)" }}>
        Engine overrides in the last 14 days.
      </p>
      {events.length === 0 ? (
        <EmptyState
          variant="inline"
          title="No automatic adjustments recently"
          body={
            hasActiveLimitation
              ? "When the engine caps or substitutes affected movements, those adjustments appear here."
              : "When you have an active limitation, the engine caps or substitutes affected movements automatically. Recent adjustments appear here."
          }
        />
      ) : (
        <ul
          data-testid="engine-event-list"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 6,
          }}
        >
          {events.map((ev) => (
            <li
              key={ev.id}
              data-testid="engine-event-row"
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: 10,
                alignItems: "baseline",
                padding: "8px 10px",
                border: "1px solid var(--cp-border)",
                borderRadius: 8,
                background: "var(--cp-surface)",
                fontSize: 12,
              }}
            >
              <span
                className="mono"
                title={new Date(ev.occurredAt).toLocaleString()}
                style={{ color: "var(--cp-text-muted)" }}
              >
                {relativeFromNow(ev.occurredAt)}
              </span>
              <span style={{ color: "var(--cp-text)" }}>
                {describeEngineEvent(ev)}
                {ev.reason ? (
                  <span
                    style={{
                      color: "var(--cp-text-muted)",
                      marginLeft: 6,
                      fontStyle: "italic",
                    }}
                  >
                    — “{ev.reason}”
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
