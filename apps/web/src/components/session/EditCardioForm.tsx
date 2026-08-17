"use client";

/**
 * Client-side wrapper for `editCardio` that:
 *   - Renders Duration in minutes (storage stays seconds)
 *   - Renders Pace as M:SS (storage stays s/km)
 *   - Adapts unit labels to the user's profile.units (km vs mi)
 *   - In "prescription-only" mode (a Quick-cardio session where no
 *     logged metrics exist yet) collapses the form to just Duration +
 *     Notes — the user is editing what they INTEND to do, not logging
 *     actual values; those land via the `<CardioLogForm>` after the
 *     workout.
 *
 * Conversion lives in `@/lib/cardio/units` (also covers Distance
 * km↔mi if/when we expose unit-aware distance editing here).
 */

import { useId, useState, useTransition } from "react";
import type { editCardio as editCardioAction } from "@/lib/sessions/actions";
import {
  parsePaceToSecPerKm,
  formatSecPerKmToPace,
  secondsToMinutes,
  paceUnitLabel,
  distanceUnitLabel,
  type PaceUnits,
} from "@/lib/cardio/units";

export type EditCardioMode =
  | { kind: "prescription-only" } // Quick workout, no metrics logged yet
  | { kind: "full" }; // normal edit (logged or completed)

export type EditCardioBlock = {
  id: string;
  duration_sec: number | null;
  distance_km: number | null;
  avg_hr_bpm: number | null;
  avg_pace_sec_per_km: number | null;
  rpe: number | string | null;
  notes: string | null;
};

export type EditCardioFormProps = {
  sessionId: string;
  block: EditCardioBlock;
  units: PaceUnits;
  mode: EditCardioMode;
  action: typeof editCardioAction;
};

export function EditCardioForm({
  sessionId,
  block,
  units,
  mode,
  action,
}: EditCardioFormProps) {
  const errId = useId();
  const [paceError, setPaceError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const initialDurationMin = secondsToMinutes(block.duration_sec) ?? "";
  const initialPace = formatSecPerKmToPace(block.avg_pace_sec_per_km, units);
  const initialDistance = block.distance_km ?? "";

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPaceError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);

    // Convert Duration (minutes → seconds) into the action's
    // canonical `durationSec` field. Always required — the schema
    // rejects empty / zero.
    const durMin = String(fd.get("durationMin") ?? "").trim();
    const durSec = durMin === "" ? "" : String(Math.round(Number(durMin) * 60));
    fd.set("durationSec", durSec);
    fd.delete("durationMin");

    // Convert Pace (M:SS → s/km). Empty pace is allowed (clears the
    // field); malformed input blocks submission with a clear error.
    const rawPace = String(fd.get("avgPace") ?? "").trim();
    if (rawPace === "") {
      fd.delete("avgPaceSecPerKm");
    } else {
      const parsed = parsePaceToSecPerKm(rawPace, units);
      if (parsed == null) {
        setPaceError(
          `Use M:SS format (e.g. 6:00 ${paceUnitLabel(units).slice(8)}).`,
        );
        return;
      }
      fd.set("avgPaceSecPerKm", String(parsed));
    }
    fd.delete("avgPace");

    startTransition(() => {
      void action(fd);
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-foreground/10 p-4"
      data-testid="edit-cardio-form"
      data-mode={mode.kind}
    >
      <input type="hidden" name="id" value={block.id} />
      <input type="hidden" name="sessionId" value={sessionId} />

      <div className="grid grid-cols-2 gap-3">
        <Field
          name="durationMin"
          label="Duration (min)"
          type="number"
          inputMode="numeric"
          min="1"
          max="600"
          required
          defaultValue={initialDurationMin}
        />

        {mode.kind === "full" ? (
          <>
            <Field
              name="distanceKm"
              label={`Distance (${distanceUnitLabel(units)})`}
              type="number"
              step="0.1"
              inputMode="decimal"
              defaultValue={initialDistance}
                />
            <Field
              name="avgHrBpm"
              label="Avg HR (bpm)"
              type="number"
              inputMode="numeric"
              defaultValue={block.avg_hr_bpm ?? ""}
                />
            <Field
              name="avgPace"
              label={`Pace (${paceUnitLabel(units)})`}
              type="text"
              inputMode="numeric"
              placeholder="6:00"
              defaultValue={initialPace}
                  aria-describedby={paceError ? errId : undefined}
            />
            <Field
              name="rpe"
              label="RPE"
              type="number"
              step="0.5"
              min="0"
              max="10"
              inputMode="decimal"
              defaultValue={block.rpe ?? ""}
                />
          </>
        ) : null}
      </div>

      {paceError && (
        <div
          id={errId}
          role="alert"
          data-testid="edit-cardio-pace-error"
          className="text-xs text-red-500"
        >
          {paceError}
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs text-foreground/60" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={400}
          defaultValue={block.notes ?? ""}
          className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        data-testid="edit-cardio-submit"
        disabled={pending}
        className="w-full rounded-md bg-foreground text-background py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  ...rest
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-foreground/60" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue ?? undefined}
        {...rest}
        className="w-full rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
      />
    </div>
  );
}
