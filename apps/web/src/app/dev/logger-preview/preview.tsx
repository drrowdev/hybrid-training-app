"use client";

/**
 * Fixture data + wiring for the dev-only logger preview. See page.tsx.
 *
 * The fixture deliberately models the hard case: one session mixing rehab,
 * a main lift with warm-ups, supplemental back-off work, an antagonist
 * superset, a loaded carry and an isometric hold.
 */

import type { Prescription } from "@hta/db";
import { AppShell } from "@/components/shell/AppShell";
import { CommandPaletteProvider } from "@/components/cmd-k/CommandPaletteProvider";
import { SessionWorkArea } from "@/components/session/SessionWorkArea";
import { SessionLoggingStateProvider } from "@/components/session/SessionLoggingState";
import type { LoggedSet } from "@/components/session/SessionLogClient";
import type { SupersetCardInfo } from "@/lib/sessions/superset-cards";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";

const MOV = {
  calf: "10000000-0000-4000-8000-000000000001",
  squat: "10000000-0000-4000-8000-000000000002",
  rdl: "10000000-0000-4000-8000-000000000003",
  legPress: "10000000-0000-4000-8000-000000000004",
  row: "10000000-0000-4000-8000-000000000005",
  carry: "10000000-0000-4000-8000-000000000006",
  plank: "10000000-0000-4000-8000-000000000007",
} as const;

const REHAB_ITEMS = [1, 2, 3].map(() => ({
  movementId: MOV.calf,
  movementSlug: "seated-calf-raise",
  movementName: "Seated Calf Raise",
  kind: "tendon" as const,
  sets: 1,
  reps: 12,
  targetWeightKg: 40,
  tempoEccentricSec: 3,
  meta: { rehab: true },
}));

const WORK_ITEMS = [
  { movementId: MOV.squat, movementSlug: "back-squat-high-bar", movementName: "Back Squat", kind: "warmup" as const, sets: 1, reps: 5, targetWeightKg: 55, percentTm: 40 },
  { movementId: MOV.squat, movementSlug: "back-squat-high-bar", movementName: "Back Squat", kind: "warmup" as const, sets: 1, reps: 5, targetWeightKg: 70, percentTm: 50 },
  { movementId: MOV.squat, movementSlug: "back-squat-high-bar", movementName: "Back Squat", kind: "warmup" as const, sets: 1, reps: 3, targetWeightKg: 85, percentTm: 60 },
  { movementId: MOV.squat, movementSlug: "back-squat-high-bar", movementName: "Back Squat", kind: "main" as const, sets: 1, reps: 5, percentTm: 75 },
  { movementId: MOV.squat, movementSlug: "back-squat-high-bar", movementName: "Back Squat", kind: "main" as const, sets: 1, reps: 5, percentTm: 82 },
  { movementId: MOV.squat, movementSlug: "back-squat-high-bar", movementName: "Back Squat", kind: "main" as const, sets: 1, reps: 5, percentTm: 90, isAmrap: true },
  ...[1, 2, 3, 4].map(() => ({
    movementId: MOV.rdl,
    movementSlug: "romanian-deadlift",
    movementName: "Romanian Deadlift",
    kind: "back_off" as const,
    sets: 1,
    reps: 8,
    percentTm: 65,
  })),
  ...[1, 2, 3].map(() => ({
    movementId: MOV.legPress,
    movementSlug: "leg-press",
    movementName: "Leg Press",
    kind: "accessory" as const,
    sets: 1,
    reps: 12,
    targetRir: { min: 1, max: 2 },
    intensityCue: "Control the lowering, no bouncing out of the bottom.",
  })),
  ...[1, 2, 3].map(() => ({
    movementId: MOV.row,
    movementSlug: "seated-cable-row",
    movementName: "Seated Cable Row",
    kind: "accessory" as const,
    sets: 1,
    reps: 12,
    targetRir: { min: 1, max: 2 },
  })),
  ...[1, 2, 3].map(() => ({
    movementId: MOV.carry,
    movementSlug: "farmer-carry-db",
    movementName: "Farmer Carry",
    kind: "accessory" as const,
    sets: 1,
    distanceM: { min: 30, max: 30 },
  })),
  ...[1, 2, 3].map(() => ({
    movementId: MOV.plank,
    movementSlug: "front-plank",
    movementName: "Front Plank",
    kind: "accessory" as const,
    sets: 1,
    holdSec: { min: 30, max: 45 },
  })),
];

const SETS: LoggedSet[] = [0, 1].map((i) => ({
  id: `20000000-0000-4000-8000-00000000000${i + 1}`,
  set_index: i,
  set_kind: "tendon",
  weight_kg: 40,
  reps: 12,
  duration_sec: null,
  distance_m: null,
  rpe: null,
  prescription_item_index: i,
  movement: {
    id: MOV.calf,
    slug: "seated-calf-raise",
    display_name: "Seated Calf Raise",
    primary_region: "lower",
  },
}));

const SUPERSETS: ReadonlyMap<string, SupersetCardInfo> = new Map([
  [MOV.legPress, { groupId: "A", slot: "A1" as const }],
  [MOV.row, { groupId: "A", slot: "A2" as const }],
]);

const noop = async () => ({ ok: true as const });

export function LoggerPreview({ variant }: { variant: string }) {
  // `norehab` is the ordinary training day — the case where the old build
  // rendered no section navigation at all.
  const withRehab = variant !== "norehab";
  const items = withRehab ? [...REHAB_ITEMS, ...WORK_ITEMS] : WORK_ITEMS;
  const prescription = { items } as unknown as Prescription;
  const sets = withRehab ? SETS : [];
  const logged: number[] = withRehab ? [0, 1] : [];

  return (
    <CommandPaletteProvider
      indices={{ pages: [], movements: [], blocks: [], sessions: [], events: [] }}
    >
      <AppShell
        signOutAction={async () => {}}
        displayName="Preview"
        email="preview@example.com"
        hapticsEnabled={false}
      >
        <SessionLoggingStateProvider
          initialHasStrengthSets={sets.length > 0}
          initialUnloggedStrengthCount={items.length - sets.length}
          initialUnloggedRehabIndices={withRehab ? [2] : []}
        >
          <h1 style={{ fontSize: 18, margin: "0 0 2px" }}>Squat day</h1>
          <p style={{ color: "var(--cp-text-muted)", fontSize: 13, margin: "0 0 12px" }}>
            Week 2 · Day 1 · in progress
          </p>
          <SessionWorkArea
            sessionId={SESSION_ID}
            isComplete={false}
            performedAt={new Date().toISOString()}
            sets={sets}
            tmBySlug={{ "back-squat-high-bar": 140, "romanian-deadlift": 120 }}
            oneRmBySlug={{}}
            /* eslint-disable @typescript-eslint/no-explicit-any -- fixture stubs */
            addStrengthSet={noop as any}
            updateStrengthSet={noop as any}
            fillFromPlan={noop as any}
            swapAction={noop as any}
            /* eslint-enable @typescript-eslint/no-explicit-any */
            hapticsEnabled={false}
            timerSoundEnabled={false}
            lastSetHints={{}}
            priorBests={{}}
            plannedSessionId="30000000-0000-4000-8000-000000000001"
            prescription={prescription}
            loggedItemIndices={logged}
            skippedItemIndices={[]}
            loggedSetIdByItemIndex={
              withRehab
                ? {
                    0: "20000000-0000-4000-8000-000000000001",
                    1: "20000000-0000-4000-8000-000000000002",
                  }
                : {}
            }
            barbellKg={20}
            plateInventory={[
              { weightKg: 25 },
              { weightKg: 20 },
              { weightKg: 15 },
              { weightKg: 10 },
              { weightKg: 5 },
              { weightKg: 2.5 },
              { weightKg: 1.25 },
            ]}
            supersetByMovementId={SUPERSETS}
            accessoryMetaById={{
              [MOV.legPress]: { equipment: "machine", region: "lower" },
              [MOV.row]: { equipment: "cable", region: "upper" },
              [MOV.carry]: { equipment: "dumbbell", region: "full" },
              [MOV.plank]: { equipment: "bodyweight", region: "core" },
            }}
            customAccessoryOrder={null}
          />
        </SessionLoggingStateProvider>
      </AppShell>
    </CommandPaletteProvider>
  );
}
