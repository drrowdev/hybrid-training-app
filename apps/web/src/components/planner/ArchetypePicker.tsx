"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ArchetypeId } from "@/lib/planner/archetypes";

export type ArchetypeOption = {
  id: ArchetypeId;
  name: string;
  oneLiner: string;
  weeks: number;
  /** Minimum days/week the archetype can run at (= number of anchor days). */
  minDays: number;
  /** Maximum days/week (= total days defined). */
  maxDays: number;
  weekLabels: string[];
  tmReady: boolean;
  missingRoles: string[];
  chosenLifts: { role: string; movement: string }[];
};

const FREQ_OPTIONS = [3, 4, 5, 6, 7];

export function ArchetypePicker({
  options,
  defaultStartedOn,
  defaultDaysPerWeek,
  dayPreviewByArchetype,
  action,
}: {
  options: ArchetypeOption[];
  defaultStartedOn: string;
  defaultDaysPerWeek: number;
  dayPreviewByArchetype: Record<string, Record<number, { strength: number; cardio: number }>>;
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [daysPerWeek, setDaysPerWeek] = useState<number>(defaultDaysPerWeek);

  const archetypesFit = (opt: ArchetypeOption) => daysPerWeek >= opt.minDays;
  const initialFitting = options.find((o) => o.tmReady && archetypesFit(o)) ?? options.find(archetypesFit) ?? options[0];
  const [selectedId, setSelectedId] = useState<ArchetypeId>(initialFitting?.id ?? "strength_anchor");
  const [startedOn, setStartedOn] = useState<string>(defaultStartedOn);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const selected = options.find((o) => o.id === selectedId) ?? options[0];
  const selectedFits = selected ? archetypesFit(selected) : false;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("archetype", selectedId);
    fd.set("startedOn", startedOn);
    fd.set("daysPerWeek", String(daysPerWeek));
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/app/plan");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
      {/* ── Days/week chip selector ────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Training days this block</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          How many days you can realistically train each week. Drops optional cardio first
          when the budget is tight; anchors stay regardless.
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FREQ_OPTIONS.map((n) => {
            const sel = n === daysPerWeek;
            return (
              <button
                type="button"
                key={n}
                onClick={() => setDaysPerWeek(n)}
                aria-pressed={sel}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  background: sel ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                  color: sel ? "var(--cp-accent)" : "var(--cp-text)",
                  fontWeight: sel ? 600 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {n} d/wk
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Archetype cards ────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Choose an archetype</h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Each archetype shapes the week differently. Pick the one that matches your current priority.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
          {options.map((opt) => {
            const isSelected = opt.id === selectedId;
            const fits = archetypesFit(opt);
            const preview = dayPreviewByArchetype[opt.id]?.[daysPerWeek];
            const cardOpacity = fits ? 1 : 0.55;
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
                  opacity: cardOpacity,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{opt.name}</h3>
                  {fits && preview ? (
                    <span className="cp-pill">
                      {opt.weeks} wk · {preview.strength}S + {preview.cardio}C
                    </span>
                  ) : (
                    <span className="cp-pill" style={{ color: "var(--cp-danger)", borderColor: "var(--cp-danger)" }}>
                      needs {opt.minDays}+ d/wk
                    </span>
                  )}
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
                {fits && !opt.tmReady && (
                  <div style={{ fontSize: 11, color: "var(--cp-danger)" }}>
                    Needs a TM for: {opt.missingRoles.join(", ")}
                  </div>
                )}
                {fits && opt.tmReady && opt.chosenLifts.length > 0 && (
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

      {/* ── Start date + submit ────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Start date</h2>
        <input
          type="date"
          value={startedOn}
          onChange={(e) => setStartedOn(e.target.value)}
          required
          style={{ padding: "8px 10px", fontSize: 14, width: "fit-content" }}
        />
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          The block snaps to the Monday of the chosen week.
        </div>
        {selected && !selectedFits && (
          <div
            style={{
              fontSize: 13,
              color: "var(--cp-danger)",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--cp-danger)",
              background: "color-mix(in oklab, var(--cp-danger) 8%, transparent)",
            }}
          >
            <strong>{selected.name}</strong> needs at least {selected.minDays} training days/week.
            Pick a higher day-count or a different archetype.
          </div>
        )}
        {selected && selectedFits && !selected.tmReady && (
          <div
            style={{
              fontSize: 13,
              color: "var(--cp-danger)",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--cp-danger)",
              background: "color-mix(in oklab, var(--cp-danger) 8%, transparent)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <div>
              <strong>You&apos;re missing a TM</strong> for: {selected.missingRoles.join(", ")}.
            </div>
            <Link href="/app/settings/training-maxes" className="cp-btn primary" style={{ fontSize: 13 }}>
              Set TMs now →
            </Link>
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              fontSize: 13,
              color: "var(--cp-danger)",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--cp-danger)",
              background: "color-mix(in oklab, var(--cp-danger) 8%, transparent)",
            }}
          >
            Couldn&apos;t create the block: {error}
          </div>
        )}
        <div>
          <button
            type="submit"
            className="cp-btn primary big"
            disabled={!selected || !selectedFits || !selected.tmReady || isPending}
          >
            {isPending ? "Generating…" : `Generate ${selected?.weeks ?? 4}-week block →`}
          </button>
        </div>
      </section>
    </form>
  );
}
