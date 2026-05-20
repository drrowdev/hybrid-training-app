"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { ArchetypeId } from "@/lib/planner/archetypes";

export type ArchetypeOption = {
  id: ArchetypeId;
  name: string;
  oneLiner: string;
  weeks: number;
  daysCount: number;
  weekLabels: string[];
  tmReady: boolean;
  missingRoles: string[];
  chosenLifts: { role: string; movement: string }[];
};

export function ArchetypePicker({
  options,
  defaultStartedOn,
  action,
}: {
  options: ArchetypeOption[];
  defaultStartedOn: string;
  action: (fd: FormData) => Promise<void> | void;
}) {
  const defaultId = options.find((o) => o.tmReady)?.id ?? options[0]?.id ?? "strength_anchor";
  const [selectedId, setSelectedId] = useState<ArchetypeId>(defaultId);
  const selected = options.find((o) => o.id === selectedId) ?? options[0];

  return (
    <form action={action} style={{ display: "grid", gap: 18 }}>
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Choose an archetype</h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Each archetype shapes the week differently. Pick the one that matches your current priority.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
          {options.map((opt) => {
            const isSelected = opt.id === selectedId;
            return (
              <button
                type="button"
                key={opt.id}
                onClick={() => setSelectedId(opt.id)}
                aria-pressed={isSelected}
                style={{
                  textAlign: "left",
                  padding: 16,
                  borderRadius: 12,
                  border: `1px solid ${isSelected ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  background: isSelected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                  color: "var(--cp-text)",
                  cursor: "pointer",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{opt.name}</h3>
                  <span className="cp-pill">
                    {opt.weeks} weeks · {opt.daysCount} d/wk
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                  {opt.oneLiner}
                </p>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {opt.weekLabels.map((label, i) => (
                    <span
                      key={i}
                      className="mono"
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--cp-surface-soft)",
                        color: "var(--cp-text-muted)",
                      }}
                    >
                      W{i + 1} · {label}
                    </span>
                  ))}
                </div>
                {!opt.tmReady && (
                  <div style={{ fontSize: 11, color: "var(--cp-danger)" }}>
                    Needs a TM for: {opt.missingRoles.join(", ")}
                  </div>
                )}
                {opt.tmReady && opt.chosenLifts.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.4 }}>
                    Will use:{" "}
                    {opt.chosenLifts.map((c, i) => (
                      <span key={c.role}>
                        {i > 0 ? " · " : ""}
                        <span style={{ color: "var(--cp-text)" }}>{c.movement}</span>
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <input type="hidden" name="archetype" value={selectedId} />

      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Start date</h2>
        <input
          type="date"
          name="startedOn"
          defaultValue={defaultStartedOn}
          required
          style={{ padding: "8px 10px", fontSize: 14, width: "fit-content" }}
        />
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          The block snaps to the Monday of the chosen week.
        </div>
        {selected && !selected.tmReady && (
          <div style={{ fontSize: 12, color: "var(--cp-danger)" }}>
            You&apos;re missing a TM for one or more required lifts. Set them in Settings → Training maxes, then come back.
          </div>
        )}
        <div>
          <StartButton disabled={selected ? !selected.tmReady : true} weeks={selected?.weeks ?? 4} />
        </div>
      </section>
    </form>
  );
}

function StartButton({ disabled, weeks }: { disabled: boolean; weeks: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cp-btn primary big" disabled={disabled || pending}>
      {pending ? "Generating…" : `Generate ${weeks}-week block →`}
    </button>
  );
}
