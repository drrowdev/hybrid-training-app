"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { TmRow, TmSourceSet } from "@/lib/training-maxes/queries";
import type { UpsertResult } from "@/lib/training-maxes/actions";
import {
  type WeightUnit,
  displayWeight,
  roundDisplayWeight,
  toKg,
  weightUnitLabel,
  epleyOneRm,
} from "@/lib/stats/units";
import { TmAutoForm } from "./TmAutoForm";
import { TmSourceBadge } from "./TmSourceBadge";
import { TmSourceDetail } from "./TmSourceDetail";
import styles from "./TmSection.module.css";

export type Candidate = { id: string; slug: string; display_name: string };
export type RoleGroupInput = {
  role: string;
  label: string;
  candidates: Candidate[];
  rows: TmRow[];
};
export type PickerGroup = {
  label: string;
  items: { id: string; display_name: string; systemLoad?: boolean }[];
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The 1-rep-max settings UI, styled to mirror the program wizard's benchmarks
 * step: one row per main lift with an uppercase role heading, a boxless variant
 * dropdown, and a boxed, directly-editable 1RM on the right.
 *
 * Weights are shown and entered in the user's chosen unit (`profiles.units`),
 * converting to kg at the storage boundary. The page only collects the 1RM — the
 * programs own their working-load settings, so this page only edits measurements.
 */
export function TmSection({
  units,
  requiredGroups,
  otherRows,
  otherRowSourceSets,
  pickerGroups,
  bodyweightKg = null,
  upsertAction,
  deleteAction,
  lockAction,
}: {
  units: WeightUnit;
  requiredGroups: RoleGroupInput[];
  otherRows: TmRow[];
  otherRowSourceSets?: Record<string, TmSourceSet | null>;
  pickerGroups: PickerGroup[];
  /** The lifter's bodyweight (kg) — lets the estimator work on a system load. */
  bodyweightKg?: number | null;
  upsertAction: (fd: FormData) => Promise<UpsertResult>;
  deleteAction: (fd: FormData) => Promise<void>;
  lockAction: (fd: FormData) => Promise<unknown>;
}) {
  const setCount = requiredGroups.filter((g) => g.rows.length > 0).length;
  const total = requiredGroups.length;
  const allSet = setCount === total;

  return (
    // See the page shell: auto grid tracks inherit the widest child's
    // min-content width, so the track is capped to keep the sections inside
    // the viewport on a phone.
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 20 }}>
      <section className="cp-card" style={{ padding: 20 }}>
        <div className={styles.head}>
          <span className={styles.headLabel}>Main lifts</span>
          <span className={`${styles.pill}${allSet ? "" : ` ${styles.pillWarn}`}`}>
            {allSet
              ? `✓ ${total} main lift${total === 1 ? "" : "s"}`
              : `${setCount}/${total} set`}
          </span>
        </div>
        <div className={styles.lifts}>
          {requiredGroups.map((group) => (
            <MainLiftRow
              key={group.role}
              units={units}
              roleLabel={group.label}
              candidates={group.candidates}
              rows={group.rows}
              upsertAction={upsertAction}
            />
          ))}
        </div>
      </section>

      {otherRows.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Other lifts</h2>
          <div className={styles.lifts}>
            {otherRows.map((r) => (
              <OtherLiftRow
                key={r.id}
                units={units}
                row={r}
                sourceSet={otherRowSourceSets?.[r.id] ?? null}
                bodyweightKg={bodyweightKg}
                upsertAction={upsertAction}
                deleteAction={deleteAction}
                lockAction={lockAction}
              />
            ))}
          </div>
        </section>
      )}

      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Add a max for any other lift</h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Saves after you select a movement and enter a 1RM.
        </p>
        <TmAutoForm mode="new" units={units} candidateGroups={pickerGroups} action={upsertAction} />
      </section>
    </div>
  );
}

/**
 * A boxed, debounced 1RM input shown/entered in the user's unit (converting to kg
 * to save) with an "Estimate" affordance that derives the 1RM from a recent set.
 */
function OneRmInput({
  active = true,
  movementId,
  ariaLabel,
  initialKg,
  units,
  isSystemLoad = false,
  bodyweightKg = null,
  action,
}: {
  active?: boolean;
  movementId: string;
  ariaLabel: string;
  initialKg: number | null;
  units: WeightUnit;
  /** This movement's max counts bodyweight plus added load. */
  isSystemLoad?: boolean;
  /** The lifter's bodyweight in kg, for the system-load estimator. */
  bodyweightKg?: number | null;
  action: (fd: FormData) => Promise<UpsertResult>;
}) {
  const unitLabel = weightUnitLabel(units);
  const toDisplay = (kg: number) => roundDisplayWeight(displayWeight(kg, units), units);

  const [draft, setDraft] = useState<string | null>(null);
  const val = draft ?? (initialKg != null ? String(toDisplay(initialKg)) : "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedKg = useRef<number | null>(initialKg);
  const [, startTransition] = useTransition();
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // `raw` is in the display unit; convert to kg to store.
  const save = (raw: string) => {
    if (!movementId) return;
    const display = Number(raw);
    const kg = toKg(display, units);
    if (!Number.isFinite(kg) || kg <= 0 || kg > 1000) {
      setStatus("error");
      setError(`Enter a positive 1RM up to ${toDisplay(1000)} ${unitLabel}.`);
      return;
    }
    if (kg === (draft === null ? initialKg : lastSavedKg.current)) return;
    const fd = new FormData();
    fd.set("movementId", movementId);
    fd.set("oneRmKg", String(kg));
    setStatus("saving");
    setError(null);
    startTransition(async () => {
      try {
        const result = await action(fd);
        if (!result.ok) {
          setStatus("error");
          setError("Couldn't save this max. Try again.");
          return;
        }
        lastSavedKg.current = kg;
        setStatus("saved");
        window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1600);
      } catch {
        setStatus("error");
        setError("Couldn't save this max. Try again.");
      }
    });
  };

  const onChange = (v: string) => {
    setDraft(v);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 600);
  };

  const applyEstimate = (displayValue: number) => {
    const rounded = roundDisplayWeight(displayValue, units);
    setDraft(String(rounded));
    setEstimateOpen(false);
    if (timer.current) clearTimeout(timer.current);
    save(String(rounded));
  };

  if (!active) return null;
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
    <div className={styles.right}>
      <button
        type="button"
        className={styles.est}
        onClick={() => setEstimateOpen((v) => !v)}
        aria-expanded={estimateOpen}
        aria-label={`Estimate 1RM for ${ariaLabel}`}
      >
        Estimate
      </button>
      <span
        aria-hidden
        className={`${styles.status}${
          status === "saved" ? ` ${styles.statusSaved}` : status === "error" ? ` ${styles.statusErr}` : ""
        }`}
      >
        {status === "saving" ? "…" : status === "saved" ? "✓" : status === "error" ? "✗" : ""}
      </span>
      <span className={styles.inp}>
        <input
          type="number"
          step={units === "imperial" ? "1" : "0.5"}
          min="1"
          value={val}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current);
            save(val);
          }}
          inputMode="decimal"
          aria-label={ariaLabel}
        />
        <span className={styles.unit}>{unitLabel}</span>
      </span>
      {estimateOpen && (
        <EstimatePopover
          units={units}
          isSystemLoad={isSystemLoad}
          bodyweightKg={bodyweightKg}
          onCancel={() => setEstimateOpen(false)}
          onApply={applyEstimate}
        />
      )}
    </div>
    {error && <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--cp-danger)" }}>{error}</p>}
    </div>
  );
}

/**
 * Inline "estimate your 1RM from a recent set" popover — weight × reps run
 * through Epley, shown in the user's unit. Apply pushes the result into the row.
 *
 * A system-load movement is estimated from the total the lifter moved, so the
 * added weight has bodyweight added to it before the formula sees it.
 */
function EstimatePopover({
  units,
  isSystemLoad = false,
  bodyweightKg = null,
  onCancel,
  onApply,
}: {
  units: WeightUnit;
  isSystemLoad?: boolean;
  bodyweightKg?: number | null;
  onCancel: () => void;
  onApply: (displayValue: number) => void;
}) {
  const inputId = useId();
  const unitLabel = weightUnitLabel(units);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("5");

  const bodyweightDisplay =
    bodyweightKg != null && bodyweightKg > 0
      ? roundDisplayWeight(displayWeight(bodyweightKg, units), units)
      : null;
  const needsBodyweight = isSystemLoad && bodyweightDisplay == null;
  const entered = Number(weight);
  const setTotal =
    isSystemLoad && bodyweightDisplay != null
      ? Number.isFinite(entered) && entered >= 0
        ? entered + bodyweightDisplay
        : 0
      : entered;
  const est = needsBodyweight ? 0 : epleyOneRm(setTotal, Number(reps));
  const estDisplay = est > 0 ? roundDisplayWeight(est, units) : 0;

  return (
    <div className={styles.pop} role="dialog" aria-label="Estimate 1RM from a set">
      <span className={styles.popH}>Estimate from a set</span>
      <p className={styles.popP}>Use a recent hard set.</p>
      <div className={styles.popFields}>
        <div className={styles.popField}>
          <label htmlFor={`${inputId}-weight`}>
            {isSystemLoad ? `Added weight (${unitLabel})` : `Weight (${unitLabel})`}
          </label>
          <span className={styles.inp}>
            <input
              id={`${inputId}-weight`}
              type="number"
              step={units === "imperial" ? "1" : "0.5"}
              min={isSystemLoad ? "0" : "1"}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              inputMode="decimal"
              aria-label={isSystemLoad ? "Added weight" : "Set weight"}
              autoFocus
            />
            <span className={styles.unit}>{unitLabel}</span>
          </span>
        </div>
        <span className={styles.popX}>×</span>
        <div className={styles.popField}>
          <label htmlFor={`${inputId}-reps`}>Reps</label>
          <span className={styles.inp}>
            <input
              id={`${inputId}-reps`}
              type="number"
              step="1"
              min="1"
              max="20"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              inputMode="numeric"
              aria-label="Set reps"
            />
          </span>
        </div>
      </div>
      <div className={styles.popRes}>
        <span className={styles.popResL}>Estimated 1RM</span>
        <span className={styles.popResV}>
          {needsBodyweight ? "Set your bodyweight" : est > 0 ? `${estDisplay} ${unitLabel}` : "—"}
        </span>
      </div>
      <div className={styles.popBtns}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.popApply}
          disabled={est <= 0}
          onClick={() => onApply(estDisplay)}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/**
 * A main-lift row selects which movement's measurement to edit.
 */
function MainLiftRow({
  units,
  roleLabel,
  candidates,
  rows,
  upsertAction,
}: {
  units: WeightUnit;
  roleLabel: string;
  candidates: Candidate[];
  rows: TmRow[];
  upsertAction: (fd: FormData) => Promise<UpsertResult>;
}) {
  const initialVariant = rows[0]?.movementId ?? candidates[0]?.id ?? "";
  const [variantId, setVariantId] = useState<string>(initialVariant);

  return (
    <div className={styles.lift}>
      <div className={styles.linfo}>
        <span className={styles.ln}>{roleLabel}</span>
        {candidates.length > 1 ? (
          <select
            className={styles.variantSel}
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            aria-label={`${roleLabel} variant`}
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.variantStatic}>
            {candidates[0]?.display_name ?? rows[0]?.movementName}
          </span>
        )}
      </div>
      {candidates.map((candidate) => (
          <OneRmInput
            key={candidate.id}
            active={candidate.id === variantId}
            units={units}
            movementId={candidate.id}
            ariaLabel={`${roleLabel} 1RM`}
            initialKg={rows.find((row) => row.movementId === candidate.id)?.oneRmKg ?? null}
            action={upsertAction}
          />
      ))}
    </div>
  );
}

/**
 * An "other lift" row — a movement the user set that isn't required by the active
 * program. Name + provenance (estimated only) on the left, editable 1RM + remove
 * on the right.
 */
function OtherLiftRow({
  units,
  row,
  sourceSet,
  bodyweightKg,
  upsertAction,
  deleteAction,
  lockAction,
}: {
  units: WeightUnit;
  row: TmRow;
  sourceSet: TmSourceSet | null;
  bodyweightKg: number | null;
  upsertAction: (fd: FormData) => Promise<UpsertResult>;
  deleteAction: (fd: FormData) => Promise<void>;
  lockAction: (fd: FormData) => Promise<unknown>;
}) {
  return (
    <div
      data-testid={`tm-card-${row.id}`}
      data-source={row.source}
      className={styles.lift}
      style={{ flexWrap: "wrap" }}
    >
      <div className={styles.linfo}>
        <span className={styles.ln}>{row.movementName}</span>
        {row.systemLoad && (
          <span className={styles.qualifier}>bodyweight + added</span>
        )}
        {row.source !== "entered" && (
          <TmSourceBadge source={row.source} formula={row.derivedFormula} />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <OneRmInput
          units={units}
          movementId={row.movementId}
          ariaLabel={
            row.systemLoad
              ? `${row.movementName} 1RM, bodyweight plus added weight`
              : `${row.movementName} 1RM`
          }
          initialKg={row.oneRmKg}
          isSystemLoad={row.systemLoad}
          bodyweightKg={bodyweightKg}
          action={upsertAction}
        />
        <form action={deleteAction}>
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            className={styles.rm}
            aria-label={`Remove ${row.movementName} 1RM`}
          >
            ✕
          </button>
        </form>
      </div>
      <div style={{ flexBasis: "100%" }}>
        <TmSourceDetail row={row} sourceSet={sourceSet} lockAction={lockAction} />
      </div>
    </div>
  );
}
