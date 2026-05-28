"use client";

/**
 * "Active limitations" set-and-forget surface — region multi-select +
 * tendinopathy toggle, both auto-saving via
 * `@/lib/settings/limitations-actions#updateLimitations`.
 *
 * Rendered at the top of /app/settings/limitations alongside the
 * detailed per-row form. Writes go through sentinel rows the rich
 * /app/recovery/injuries flow never touches — see the action module
 * for the storage model.
 */
import { useCallback, useState, useTransition } from "react";
import {
  REGIONS,
  type Region,
  type UpdateLimitationsInput,
  updateLimitations,
} from "@/lib/settings/limitations-actions";

const REGION_LABELS: Record<Region, string> = {
  foot_ankle_calf: "Foot / ankle / calf",
  knee: "Knee",
  hamstring_posterior: "Hamstring / posterior chain",
  adductor_groin: "Adductor / groin",
  lumbar_trunk: "Lumbar / trunk",
  shoulder_scapular: "Shoulder / scapular",
  elbow_forearm: "Elbow / forearm",
};

export function LimitationsToggleSection({
  initialBlockedRegions,
  initialTendinopathyActive,
}: {
  initialBlockedRegions: ReadonlyArray<Region>;
  initialTendinopathyActive: boolean;
}) {
  const [blocked, setBlocked] = useState<Set<Region>>(
    () => new Set(initialBlockedRegions),
  );
  const [tendinopathy, setTendinopathy] = useState(initialTendinopathyActive);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const persist = useCallback(
    (nextBlocked: Set<Region>, nextTendinopathy: boolean) => {
      const input: UpdateLimitationsInput = {
        blockedRegions: Array.from(nextBlocked),
        tendinopathyActive: nextTendinopathy,
      };
      startTransition(async () => {
        setError(null);
        setSaved(false);
        const r = await updateLimitations(input);
        if (!r.ok) setError(r.error);
        else setSaved(true);
      });
    },
    [],
  );

  const toggleRegion = (region: Region) => {
    const next = new Set(blocked);
    if (next.has(region)) next.delete(region);
    else next.add(region);
    setBlocked(next);
    persist(next, tendinopathy);
  };

  const toggleTendinopathy = () => {
    const next = !tendinopathy;
    setTendinopathy(next);
    persist(blocked, next);
  };

  return (
    <section className="space-y-3 rounded-lg border border-foreground/10 p-4">
      <header className="space-y-1">
        <h2 className="text-base font-medium">Active limitations</h2>
        <p className="text-xs text-foreground/60">
          Used to filter accessories and power primers when generating new
          blocks. Set once; clear when symptoms resolve.
        </p>
      </header>

      <fieldset className="space-y-2">
        <legend className="text-xs text-foreground/60">Blocked regions</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {REGIONS.map((region) => {
            const on = blocked.has(region);
            return (
              <label
                key={region}
                className="flex items-center gap-2 rounded-md border border-foreground/10 px-2 py-1.5 text-sm hover:bg-foreground/5"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleRegion(region)}
                  disabled={pending}
                  data-testid={`limitations-region-${region}`}
                  className="accent-foreground"
                />
                <span>{REGION_LABELS[region]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-start gap-2 rounded-md border border-foreground/10 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={tendinopathy}
          onChange={toggleTendinopathy}
          disabled={pending}
          data-testid="limitations-tendinopathy"
          className="mt-0.5 accent-foreground"
        />
        <span>
          <span className="font-medium">
            Active tendinopathy / tendon irritation
          </span>
          <span className="block text-xs text-foreground/60">
            Drops plyometrics, Olympic primers, and high-strain tendon
            accessories from generated blocks.
          </span>
        </span>
      </label>

      <div className="min-h-[1rem] text-xs">
        {error && <span className="text-red-600">{error}</span>}
        {!error && saved && (
          <span className="text-foreground/50">Saved.</span>
        )}
        {!error && !saved && pending && (
          <span className="text-foreground/50">Saving…</span>
        )}
      </div>
    </section>
  );
}
