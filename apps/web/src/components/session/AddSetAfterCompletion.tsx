"use client";

/**
 * Add a set to a movement on an ALREADY-COMPLETED session.
 *
 * ## Why
 *
 * Finishing a session used to freeze it: the read-only card exposed a per-set
 * Edit link but no way to record a set the app never gave you a slot for
 * ("I did a 4th set the prescription didn't have"). The only escape was to
 * leave the record wrong. The Today/Plan drawer's ✎ Edit now opens the full
 * session view, so this is the affordance that makes that destination actually
 * useful.
 *
 * ## Product posture
 *
 * - The completed view stays READ-ONLY BY DEFAULT. `AddSetAfterCompletion` is a
 *   collapsed disclosure, not an open form: reviewing a session cannot turn into
 *   accidentally editing it.
 * - Adding a set does NOT re-open the session. `completed_at` is untouched, the
 *   session stays "complete", and the set is recorded like any other.
 *   Un-completing would cascade into block completion, the Today rail and the
 *   plan's done-state for what is a record correction, not a resumed workout.
 * - DC-K4 (override-and-warn, never silent overrule): editing history is
 *   permitted, but we state what it changes rather than blocking it. Hard blocks
 *   stay reserved for safety gates.
 *
 * ## Attribution
 *
 * The set is submitted with NO `prescriptionItemIndex`, so
 * `set_logs.prescription_item_index` is NULL. That is deliberate — a post-hoc
 * set has no prescribed slot, and NULL is the one value that cannot collide
 * with, or shift, an existing index (see `lib/sessions/movement-attribution.ts`:
 * pass 1 only claims rows with a valid in-range index; an unlinked row then
 * claims the first still-unclaimed matching slot, else falls back to
 * exclusive-movement ownership). Re-indexing logged rows is a known attribution
 * hazard; we never do it here.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useUnits } from "@/lib/units/context";
import { type WeightUnit, toKg, weightUnitLabel } from "@/lib/stats/units";
import {
  SET_KINDS,
  SET_KIND_LABELS,
  type SetKind,
} from "@/lib/sessions/set-kind-labels";

/** DC-K4 — warn, don't block. Exported so the copy can be pinned by a test. */
export const POST_HOC_SET_WARNING =
  "This session is already finished. The set is recorded as part of it — the session stays complete, and stress load plus region freshness are recalculated.";

export type PostHocSetInput = {
  sessionId: string;
  movementId: string;
  setKind: SetKind;
  /** Raw field values, in the user's display unit. */
  weight: string;
  reps: string;
  rpe: string;
  units: WeightUnit;
};

/**
 * Validate + convert a post-hoc set into the `addStrengthSet` payload.
 *
 * Single home (plan §6.9) for the rule that matters here: the payload MUST NOT
 * carry a `prescriptionItemIndex`. Pure, so the contract is unit-testable
 * without a DOM.
 */
export function buildPostHocSetPayload(
  input: PostHocSetInput,
): { error: string } | { fd: FormData } {
  const repsNum = Number(input.reps);
  if (input.reps.trim() === "" || !Number.isFinite(repsNum) || repsNum < 1) {
    return { error: "Enter the reps you did." };
  }
  const weightNum = input.weight.trim() === "" ? 0 : Number(input.weight);
  if (!Number.isFinite(weightNum) || weightNum < 0) {
    return { error: "Enter a valid weight (0 for bodyweight)." };
  }
  const rpeNum = input.rpe.trim() === "" ? null : Number(input.rpe);
  if (rpeNum != null && (!Number.isFinite(rpeNum) || rpeNum < 0 || rpeNum > 10)) {
    return { error: "RPE must be between 0 and 10." };
  }

  const fd = new FormData();
  fd.set("sessionId", input.sessionId);
  fd.set("movementId", input.movementId);
  fd.set("setKind", input.setKind);
  fd.set("weightKg", String(toKg(weightNum, input.units)));
  fd.set("reps", String(Math.round(repsNum)));
  if (rpeNum != null) fd.set("rpe", String(rpeNum));
  // Deliberately NO `prescriptionItemIndex` — see the module header.
  return { fd };
}

export type AddSetAfterCompletionProps = {
  sessionId: string;
  movementId: string;
  movementName: string;
  addStrengthSet: (fd: FormData) => Promise<{ error?: string; ok?: true }>;
  /**
   * Pre-selects the kind the movement was programmed / last logged as, so the
   * common "one more working set" case is a two-field edit. Set kind is not
   * cosmetic: only `main` / `back_off` rows feed PR detection and training-max
   * recalibration.
   */
  defaultSetKind?: SetKind;
};

/**
 * Disclosure wrapper. Renders a single button until the user opts in — the
 * read-only-by-default posture — then hands off to `PostHocSetForm`.
 */
export function AddSetAfterCompletion(props: AddSetAfterCompletionProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div data-testid={`add-set-after-completion-${props.movementId}`}>
        <button
          type="button"
          data-testid={`add-set-after-completion-open-${props.movementId}`}
          onClick={() => setOpen(true)}
          className="cp-btn"
          style={{ padding: "6px 10px", fontSize: 11 }}
        >
          ＋ Add a set
        </button>
      </div>
    );
  }

  return <PostHocSetForm {...props} onClose={() => setOpen(false)} />;
}

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 11,
  color: "var(--cp-text-muted)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-bg)",
  color: "var(--cp-text)",
};

/**
 * The expanded form. Exported so its open-state contract (the DC-K4 warning,
 * the field set, the set-kind default) can be pinned in a static render — the
 * disclosure above cannot be opened without a DOM.
 */
export function PostHocSetForm({
  sessionId,
  movementId,
  movementName,
  addStrengthSet,
  defaultSetKind = "main",
  onClose,
}: AddSetAfterCompletionProps & { onClose: () => void }) {
  const router = useRouter();
  const units = useUnits();
  const [setKind, setSetKind] = useState<SetKind>(defaultSetKind);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const built = buildPostHocSetPayload({
      sessionId,
      movementId,
      setKind,
      weight,
      reps,
      rpe,
      units,
    });
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addStrengthSet(built.fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      onClose();
      // No optimistic overlay covers an unlinked set (SessionWorkArea only
      // builds one for a prescription-linked log), so pull the server snapshot
      // the action has just re-stamped rather than guessing.
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={submit}
      data-testid={`add-set-after-completion-form-${movementId}`}
      style={{
        display: "grid",
        gap: 10,
        padding: 12,
        borderRadius: 10,
        border: "1px dashed var(--cp-border)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-text)" }}>
        Add a set to {movementName}
      </div>

      <div
        data-testid={`add-set-after-completion-warning-${movementId}`}
        style={{ fontSize: 11, color: "var(--cp-warning)", lineHeight: 1.4 }}
      >
        {POST_HOC_SET_WARNING}
      </div>

      <label style={labelStyle}>
        Set type
        <select
          value={setKind}
          onChange={(e) => setSetKind(e.target.value as SetKind)}
          data-testid={`add-set-after-completion-kind-${movementId}`}
          style={inputStyle}
        >
          {SET_KINDS.map((k) => (
            <option key={k} value={k}>
              {SET_KIND_LABELS[k].label}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <label style={labelStyle}>
          Weight ({weightUnitLabel(units)})
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            data-testid={`add-set-after-completion-weight-${movementId}`}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Reps
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            data-testid={`add-set-after-completion-reps-${movementId}`}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          RPE
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            max="10"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            data-testid={`add-set-after-completion-rpe-${movementId}`}
            style={inputStyle}
          />
        </label>
      </div>

      {error && (
        <div
          role="alert"
          data-testid={`add-set-after-completion-error-${movementId}`}
          style={{ fontSize: 12, color: "var(--cp-danger)" }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={pending}
          data-testid={`add-set-after-completion-save-${movementId}`}
          className="cp-btn cp-btn-primary"
          style={{ padding: "8px 14px", fontSize: 12 }}
        >
          {pending ? "Saving…" : "Save set"}
        </button>
        <button
          type="button"
          onClick={onClose}
          data-testid={`add-set-after-completion-cancel-${movementId}`}
          className="cp-btn"
          style={{ padding: "8px 14px", fontSize: 12 }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
