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
  /** Minimum days/week the archetype can run at (= distinct anchor calendar days). */
  minDays: number;
  /** Maximum days/week (= distinct days defined). */
  maxDays: number;
  /** True when the archetype is rendering its two-a-day variant (user opted in + variant exists). */
  twoADay: boolean;
  /** True when this archetype defines a two-a-day variant the user could opt into. */
  hasTwoADayVariant: boolean;
  weekLabels: string[];
  tmReady: boolean;
  missingRoles: string[];
  chosenLifts: { role: string; movement: string }[];
};

const FREQ_OPTIONS = [3, 4, 5, 6, 7];

/**
 * Floor for bodyweight-only users when computing the per-archetype min-days
 * gate. The BW prescription engine packs ~3 main families per session via
 * `bw-family-rotation.ts` regardless of which archetype is picked, so the
 * anchor-day count doesn't constrain frequency; we just keep a non-zero
 * floor so a 1-day block isn't selectable.
 */
const BW_MIN_DAYS_FLOOR = 2;

export function ArchetypePicker({
  options,
  defaultStartedOn,
  defaultDaysPerWeek,
  dayPreviewByArchetype,
  amWindowStart,
  pmWindowStart,
  action,
  isBodyweightOnly = false,
}: {
  options: ArchetypeOption[];
  defaultStartedOn: string;
  defaultDaysPerWeek: number;
  dayPreviewByArchetype: Record<string, Record<number, { strength: number; cardio: number }>>;
  amWindowStart: string;
  pmWindowStart: string;
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * When true, override `option.minDays` with `BW_MIN_DAYS_FLOOR` for the
   * fit check + card pill, and swap the per-selected hint to BW-aware copy.
   */
  isBodyweightOnly?: boolean;
}) {
  const effectiveMinDays = (opt: ArchetypeOption) =>
    isBodyweightOnly ? BW_MIN_DAYS_FLOOR : opt.minDays;

  const [daysPerWeek, setDaysPerWeek] = useState<number>(defaultDaysPerWeek);

  const archetypesFit = (opt: ArchetypeOption) => daysPerWeek >= effectiveMinDays(opt);
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
          How many days you can realistically train each week. Each focus keeps its own
          anchor days first — Strength Focus protects the four main lifts; Endurance Focus
          protects the long run + VO2 day. Optional sessions are dropped to fit the budget.
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

      {/* ── Focus cards ───────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Choose your focus</h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Each focus shapes the week differently. Pick the one that matches your current priority.
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
                      {opt.weeks} wk · {preview.strength}S + {preview.cardio}C{opt.twoADay ? " · 2/day" : ""}
                    </span>
                  ) : (
                    <span className="cp-pill" style={{ color: "var(--cp-danger)", borderColor: "var(--cp-danger)" }}>
                      needs {effectiveMinDays(opt)}+ d/wk
                    </span>
                  )}
                </div>
                {opt.twoADay && (
                  <div style={{ fontSize: 11, color: "var(--cp-accent)" }}>
                    Two-a-day variant — AM {amWindowStart} lift + PM {pmWindowStart} cardio.
                  </div>
                )}
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

          {/* Custom block — navigates to the builder instead of selecting in-form. */}
          <Link
            href="/app/plan/new/custom"
            style={{
              textAlign: "left",
              padding: 16,
              borderRadius: 12,
              border: "1px dashed var(--cp-border-strong)",
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              textDecoration: "none",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Custom block</h3>
              <span className="cp-pill">build your own</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
              Pick the weeks, intensity wave, and what happens on each day. Same generator as the curated
              presets — strength days use your chosen variants.
            </p>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(["Block length", "Wave template", "Per-day editor", "Custom durations"] as const).map((label) => (
                <span
                  key={label}
                  className="mono"
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--cp-surface-soft)",
                    color: "var(--cp-text-muted)",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--cp-link)", marginTop: 2 }}>Open the builder →</div>
          </Link>
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
            {isBodyweightOnly ? (
              <>
                Bodyweight blocks run at any frequency — the engine rotates families per session.
                Pick at least {effectiveMinDays(selected)} day{effectiveMinDays(selected) === 1 ? "" : "s"}/week to continue.
              </>
            ) : (
              <>
                <strong>{selected.name}</strong> needs at least {selected.minDays} training days/week.
                Pick a higher day-count or a different focus.
              </>
            )}
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
