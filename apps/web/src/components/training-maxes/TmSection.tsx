"use client";

import { useRef, useState, useTransition } from "react";
import type { TmRow, TmSourceSet } from "@/lib/training-maxes/queries";
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
  setRow?: TmRow;
  setRowSourceSet?: TmSourceSet | null;
};
export type PickerGroup = { label: string; items: { id: string; display_name: string }[] };

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The 1-rep-max settings UI, styled to mirror the program wizard's benchmarks
 * step: one row per main lift with an uppercase role heading, a boxless variant
 * dropdown, and a boxed, directly-editable 1RM on the right.
 *
 * Weights are shown and entered in the user's chosen unit (`profiles.units`),
 * converting to kg at the storage boundary. The page only collects the 1RM — the
 * working weights a program trains at are a PROGRAM concern (seeded onto
 * `training_maxes.tm_percent` at deploy), so there's no training-max % here.
 */
export function TmSection({
  units,
  requiredGroups,
  otherRows,
  otherRowSourceSets,
  pickerGroups,
  hasActiveBlock,
  upsertAction,
  moveAction,
  deleteAction,
  lockAction,
}: {
  units: WeightUnit;
  requiredGroups: RoleGroupInput[];
  otherRows: TmRow[];
  otherRowSourceSets?: Record<string, TmSourceSet | null>;
  pickerGroups: PickerGroup[];
  hasActiveBlock: boolean;
  upsertAction: (fd: FormData) => Promise<unknown>;
  moveAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
  lockAction: (fd: FormData) => Promise<unknown>;
}) {
  const setCount = requiredGroups.filter((g) => g.setRow).length;
  const total = requiredGroups.length;
  const allSet = setCount === total;

  return (
    <div style={{ display: "grid", gap: 20 }}>
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
              setRow={group.setRow}
              upsertAction={upsertAction}
              moveAction={moveAction}
            />
          ))}
        </div>
        {hasActiveBlock && (
          <p className={styles.note}>
            🔒 Your active program uses these 1-rep maxes to set your working
            weights.
          </p>
        )}
      </section>

      {otherRows.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Other lifts</h2>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            1-rep maxes you&apos;ve set that aren&apos;t required by the active program.
          </p>
          <div className={styles.lifts}>
            {otherRows.map((r) => (
              <OtherLiftRow
                key={r.id}
                units={units}
                row={r}
                sourceSet={otherRowSourceSets?.[r.id] ?? null}
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
          Pick from the catalog of compound movements — autosaves once you select a movement and enter your 1RM.
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
  movementId,
  ariaLabel,
  initialKg,
  units,
  action,
}: {
  movementId: string;
  ariaLabel: string;
  initialKg: number | null;
  units: WeightUnit;
  action: (fd: FormData) => Promise<unknown>;
}) {
  const unitLabel = weightUnitLabel(units);
  const toDisplay = (kg: number) => roundDisplayWeight(displayWeight(kg, units), units);

  const [val, setVal] = useState<string>(initialKg != null ? String(toDisplay(initialKg)) : "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [estimateOpen, setEstimateOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedKg = useRef<number | null>(initialKg);
  const [, startTransition] = useTransition();

  // `raw` is in the display unit; convert to kg to store.
  const save = (raw: string) => {
    if (!movementId) return;
    const display = Number(raw);
    if (!Number.isFinite(display) || display <= 0) return;
    const kg = toKg(display, units);
    if (kg <= 0 || kg > 1000 || kg === lastSavedKg.current) return;
    const fd = new FormData();
    fd.set("movementId", movementId);
    fd.set("oneRmKg", String(kg));
    setStatus("saving");
    startTransition(async () => {
      try {
        const result = (await action(fd)) as
          | undefined
          | void
          | { ok: true }
          | { ok: false; error: string };
        if (result && typeof result === "object" && "ok" in result && result.ok === false) {
          setStatus("error");
          return;
        }
        lastSavedKg.current = kg;
        setStatus("saved");
        window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1600);
      } catch {
        setStatus("error");
      }
    });
  };

  const onChange = (v: string) => {
    setVal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 600);
  };

  const applyEstimate = (displayValue: number) => {
    const rounded = roundDisplayWeight(displayValue, units);
    setVal(String(rounded));
    setEstimateOpen(false);
    if (timer.current) clearTimeout(timer.current);
    save(String(rounded));
  };

  return (
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
          onCancel={() => setEstimateOpen(false)}
          onApply={applyEstimate}
        />
      )}
    </div>
  );
}

/**
 * Inline "estimate your 1RM from a recent set" popover — weight × reps run
 * through Epley, shown in the user's unit. Apply pushes the result into the row.
 */
function EstimatePopover({
  units,
  onCancel,
  onApply,
}: {
  units: WeightUnit;
  onCancel: () => void;
  onApply: (displayValue: number) => void;
}) {
  const unitLabel = weightUnitLabel(units);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("5");

  const est = epleyOneRm(Number(weight), Number(reps));
  const estDisplay = est > 0 ? roundDisplayWeight(est, units) : 0;

  return (
    <div className={styles.pop} role="dialog" aria-label="Estimate 1RM from a set">
      <span className={styles.popH}>Estimate from a set</span>
      <p className={styles.popP}>Enter a recent hard set and we&apos;ll work out your 1-rep max.</p>
      <div className={styles.popFields}>
        <div className={styles.popField}>
          <label htmlFor="est-weight">Weight ({unitLabel})</label>
          <span className={styles.inp}>
            <input
              id="est-weight"
              type="number"
              step={units === "imperial" ? "1" : "0.5"}
              min="1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              inputMode="decimal"
              aria-label="Set weight"
              autoFocus
            />
            <span className={styles.unit}>{unitLabel}</span>
          </span>
        </div>
        <span className={styles.popX}>×</span>
        <div className={styles.popField}>
          <label htmlFor="est-reps">Reps</label>
          <span className={styles.inp}>
            <input
              id="est-reps"
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
        <span className={styles.popResV}>{est > 0 ? `${estDisplay} ${unitLabel}` : "—"}</span>
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
 * A required main-lift row: uppercase role heading + a variant dropdown
 * (switching it moves the 1RM onto the chosen variant) + the boxed 1RM input.
 */
function MainLiftRow({
  units,
  roleLabel,
  candidates,
  setRow,
  upsertAction,
  moveAction,
}: {
  units: WeightUnit;
  roleLabel: string;
  candidates: Candidate[];
  setRow?: TmRow;
  upsertAction: (fd: FormData) => Promise<unknown>;
  moveAction: (fd: FormData) => Promise<unknown>;
}) {
  const initialVariant = setRow?.movementId ?? candidates[0]?.id ?? "";
  const [variantId, setVariantId] = useState<string>(initialVariant);
  const [, startTransition] = useTransition();

  const onVariant = (newId: string) => {
    setVariantId(newId);
    // If a 1RM already exists for this role, move it onto the chosen variant so
    // the role keeps exactly one number. With no row yet, just retarget entry.
    if (setRow && newId !== setRow.movementId) {
      const fd = new FormData();
      fd.set("fromMovementId", setRow.movementId);
      fd.set("toMovementId", newId);
      startTransition(async () => {
        await moveAction(fd);
      });
    }
  };

  return (
    <div className={styles.lift}>
      <div className={styles.linfo}>
        <span className={styles.ln}>{roleLabel}</span>
        {candidates.length > 1 ? (
          <select
            className={styles.variantSel}
            value={variantId}
            onChange={(e) => onVariant(e.target.value)}
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
            {candidates[0]?.display_name ?? setRow?.movementName}
          </span>
        )}
      </div>
      <OneRmInput
        // Remount the input when the targeted variant changes so it re-seeds
        // from the (possibly moved) row's value.
        key={variantId}
        units={units}
        movementId={variantId}
        ariaLabel={`${roleLabel} 1RM`}
        initialKg={variantId === setRow?.movementId ? setRow?.oneRmKg ?? null : null}
        action={upsertAction}
      />
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
  upsertAction,
  deleteAction,
  lockAction,
}: {
  units: WeightUnit;
  row: TmRow;
  sourceSet: TmSourceSet | null;
  upsertAction: (fd: FormData) => Promise<unknown>;
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
        {row.source !== "entered" && (
          <TmSourceBadge source={row.source} formula={row.derivedFormula} />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <OneRmInput
          units={units}
          movementId={row.movementId}
          ariaLabel={`${row.movementName} 1RM`}
          initialKg={row.oneRmKg}
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
