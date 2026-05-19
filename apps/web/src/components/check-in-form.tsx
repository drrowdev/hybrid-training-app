"use client";

import { useState } from "react";

/** Two-slider DC-P1 check-in (Fatigue + Soreness, 1–5). */
export function CheckInForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [fatigue, setFatigue] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const labels = ["1 fresh", "2 ok", "3 heavy", "4 drained", "5 cooked"];
  const sorenessLabels = ["1 none", "2 mild", "3 moderate", "4 high", "5 severe"];

  const choice = (
    field: "fatigue" | "soreness",
    setter: (n: number) => void,
    current: number | null,
    labelSet: string[],
  ) => (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline">
        <label className="text-sm font-medium capitalize">{field}</label>
        <span className="text-xs text-foreground/50">{current ? labelSet[current - 1] : "—"}</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setter(n)}
            aria-label={labelSet[n - 1]}
            className={`py-2 rounded-md text-sm font-medium transition ${
              current === n
                ? "bg-foreground text-background"
                : "bg-foreground/5 hover:bg-foreground/10"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="fatigue" value={fatigue ?? ""} />
      <input type="hidden" name="soreness" value={soreness ?? ""} />

      {choice("fatigue", setFatigue, fatigue, labels)}
      {choice("soreness", setSoreness, soreness, sorenessLabels)}

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="title">
          Session title (optional)
        </label>
        <input
          id="title"
          name="title"
          type="text"
          placeholder="e.g. Upper push + Z2 bike"
          maxLength={120}
          className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-3 items-center">
        <button
          type="submit"
          className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          Start session
        </button>
        <button
          type="submit"
          formNoValidate
          className="text-xs text-foreground/50 hover:text-foreground"
        >
          Skip check-in
        </button>
      </div>
    </form>
  );
}
