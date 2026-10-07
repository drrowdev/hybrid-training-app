"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { CommandPaletteProvider } from "@/components/cmd-k/CommandPaletteProvider";
import { SessionWorkArea } from "@/components/session/SessionWorkArea";
import { SessionLoggingStateProvider } from "@/components/session/SessionLoggingState";
import type { LoggedSet } from "@/components/session/SessionLogClient";
import type { AddStrengthSetResult } from "@/lib/sessions/actions";
import { authoredCatalog, authoredFixturePrescription } from "./authored-fixture";

const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const STORAGE_KEY = "hta.synthetic-authored-logs";
const prescription = authoredFixturePrescription();
type CardioLog = { id: string; blockIndex: number; durationSec: number };
type FixtureLogs = { sets: LoggedSet[]; cardio: CardioLog[] };

export function AuthoredLoggerPreview({ rejectFirst = false, rejectFinal = false }: { rejectFirst?: boolean; rejectFinal?: boolean }) {
  const [logs, setLogs] = useState<FixtureLogs>({ sets: [], cardio: [] });
  const [ready, setReady] = useState(false);
  const rejected = useRef(false);
  const cardioRejected = useRef(false);
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synthetic reloadable fixture, no server or user data
    if (stored) setLogs(JSON.parse(stored) as FixtureLogs);
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }, [logs, ready]);
  const addStrengthSet = async (fd: FormData): Promise<AddStrengthSetResult> => {
    const index = Number(fd.get("prescriptionItemIndex"));
    if ((rejectFirst || rejectFinal && index === prescription.items.length - 1) && !rejected.current) {
      rejected.current = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { error: "Synthetic save rejected", errorCode: "validation" };
    }
    const movement = authoredCatalog.find((entry) => entry.id === fd.get("movementId"))!;
    const id = String(fd.get("clientLogId"));
    const skipped = fd.get("skipped") === "true";
    const kind = String(fd.get("setKind"));
    const row: LoggedSet = {
      id, client_log_id: id, set_index: index, set_kind: kind, prescription_item_index: index,
      weight_kg: Number(fd.get("weightKg")), reps: Number(fd.get("reps")), rpe: null,
      duration_sec: null, distance_m: null, skipped,
      movement: { id: movement.id, slug: movement.slug, display_name: movement.displayName, primary_region: "upper" },
    };
    setLogs((previous) => previous.sets.some((set) => set.id === id) ? previous : { ...previous, sets: [...previous.sets, row] });
    return { ok: true, set: { id, movementId: movement.id, prescriptionItemIndex: index, setKind: kind, skipped } };
  };
  const updateStrengthSet = async (fd: FormData) => {
    setLogs((previous) => ({ ...previous, sets: previous.sets.map((set) =>
      set.id === fd.get("setId") ? { ...set, weight_kg: Number(fd.get("weightKg")), reps: Number(fd.get("reps")) } : set) }));
    return { ok: true as const };
  };
  const logged = logs.sets.map((set) => set.prescription_item_index!);
  const covered = new Set([...logged, ...logs.cardio.map((log) => log.blockIndex - 1)]);
  if (!ready) return null;
  return <CommandPaletteProvider indices={{ pages: [], movements: [], blocks: [], sessions: [], events: [] }}>
    <AppShell signOutAction={async () => {}} displayName="Preview" email="preview@example.com" hapticsEnabled={false}>
      <SessionLoggingStateProvider initialHasStrengthSets={logs.sets.length > 0}
        initialLoggedStrengthClientIds={logs.sets.map((set) => set.id)}
        initialLoggedCardioItemIndices={logs.cardio.map((log) => log.blockIndex - 1)}
        initialUnloggedStrengthCount={prescription.items.filter((item, index) => !item.kind.startsWith("cardio_") && !covered.has(index)).length}
        initialUnloggedRehabIndices={prescription.items.flatMap((item, index) => item.meta?.rehab && !covered.has(index) ? [index] : [])}
        initialUnloggedRequiredIndices={prescription.items.flatMap((item, index) => !item.optional && item.kind !== "warmup" && !covered.has(index) ? [index] : [])}>
        <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Upper + conditioning</h1>
        <SessionWorkArea sessionId={SESSION_ID} isComplete={false} performedAt="2026-10-07T12:00:00Z"
          sets={logs.sets} tmBySlug={{}} oneRmBySlug={Object.fromEntries(authoredCatalog.filter((movement) => movement.oneRmKg != null).map((movement) => [movement.slug, movement.oneRmKg!]))}
          prescription={prescription} plannedSessionId={null} loggedItemIndices={logged} skippedItemIndices={[]}
          loggedSetIdByItemIndex={Object.fromEntries(logs.sets.map((set) => [set.prescription_item_index!, set.id]))}
          addStrengthSet={addStrengthSet} updateStrengthSet={updateStrengthSet} fillFromPlan={async () => ({ ok: true })}
          swapAction={async () => ({ ok: true })} lastSetHints={{}} priorBests={{}}
          hapticsEnabled={false} timerSoundEnabled={false} restTimerEnabled
          bodyweightKg={87} bodyweightMovementIds={[authoredCatalog[1]!.id]} systemLoadMovementIds={[authoredCatalog[1]!.id]}
          barbellKg={20} plateInventory={[{ weightKg: 1.25 }, { weightKg: 5 }, { weightKg: 20 }]}
          accessoryMetaById={Object.fromEntries(authoredCatalog.map((movement) => [movement.id, { equipment: movement.equipment, region: null }]))}
          authoredCardio={{ units: "metric", logs: logs.cardio, action: async (fd) => {
            if (rejectFirst && !cardioRejected.current) {
              cardioRejected.current = true;
              return { error: "Synthetic cardio rejected", errorCode: "validation" };
            }
            const id = String(fd.get("clientLogId"));
            const blockIndex = Number(fd.get("prescriptionItemIndex")) + 1;
            setLogs((previous) => previous.cardio.some((log) => log.id === id) ? previous
              : { ...previous, cardio: [...previous.cardio, { id, blockIndex, durationSec: Number(fd.get("actualDurationMin")) * 60 }] });
            return { ok: true };
          } }}
        />
      </SessionLoggingStateProvider>
    </AppShell>
  </CommandPaletteProvider>;
}
