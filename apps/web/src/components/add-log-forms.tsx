"use client";

import { useState, useActionState } from "react";
import { MovementPicker, type MovementSearchResult } from "@/components/movement-picker";
import { RpeInput } from "@/components/forms/RpeInput";

type Action = (fd: FormData) => Promise<{ error?: string; ok?: true }>;
type State = { error?: string; ok?: true } | null;

const wrap = (action: Action) => async (_prev: State, fd: FormData): Promise<State> =>
  action(fd);

export function AddStrengthSetForm({
  sessionId,
  action,
}: {
  sessionId: string;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(wrap(action), null);
  const [selected, setSelected] = useState<MovementSearchResult | null>(null);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-foreground/10 p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <h3 className="text-sm font-medium">Add strength set</h3>

      <MovementPicker name="movementId" onChange={setSelected} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field name="weightKg" label="Weight (kg)" type="number" step="0.5" inputMode="decimal" />
        <Field name="reps" label="Reps" type="number" inputMode="numeric" />
        <div className="space-y-1 col-span-2 sm:col-span-2">
          {/* RpeInput — shared chip grid (issue #210). */}
          <RpeInput name="rpe" context="strength" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="setKind">Set kind</label>
          <select
            id="setKind"
            name="setKind"
            defaultValue="main"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
          >
            <option value="warmup">warmup</option>
            <option value="main">main</option>
            <option value="back_off">Volume set</option>
            <option value="accessory">accessory</option>
            <option value="tendon">tendon</option>
          </select>
        </div>
      </div>

      <details className="text-xs text-foreground/60">
        <summary className="cursor-pointer select-none hover:text-foreground">
          + duration hold / distance (for isometrics, sled, carries)
        </summary>
        <div className="grid grid-cols-2 gap-3 pt-3">
          <Field name="durationSec" label="Hold (s)" type="number" inputMode="numeric" />
          <Field name="distanceM" label="Distance (m)" type="number" inputMode="numeric" />
        </div>
      </details>

      <Field name="notes" label="Notes (optional)" type="text" maxLength={400} />

      <div className="flex items-center justify-between gap-3">
        <button
          type="submit"
          disabled={pending || !selected}
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : "Log set"}
        </button>
        {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        {state?.ok && <p className="text-xs text-emerald-600">Logged.</p>}
      </div>
    </form>
  );
}

// AddCardioBlockForm was removed in the Mockup-B / AddToWorkout refactor.
// The unified `AddToWorkout` component now owns this surface and calls
// `addCardioBlock` directly.

function Field({
  name,
  label,
  ...rest
}: {
  name: string;
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-foreground/60" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        {...rest}
        className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
      />
    </div>
  );
}
