/**
 * Optimistic set-logging overlay — pure merge/reconcile helpers.
 */
import { describe, it, expect } from "vitest";
import type { LoggedSet } from "@/components/session/SessionLogClient";
import {
  optimisticLogFromFormData,
  pendingLogToLoggedSet,
  serverHasPendingLog,
  mergeOptimisticSets,
  type OptimisticLog,
} from "../optimistic-log";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function serverSet(over: Partial<LoggedSet> & { id: string }): LoggedSet {
  return {
    id: over.id,
    set_index: over.set_index ?? 0,
    set_kind: over.set_kind ?? "main",
    weight_kg: over.weight_kg ?? null,
    reps: over.reps ?? null,
    duration_sec: over.duration_sec ?? null,
    distance_m: over.distance_m ?? null,
    rpe: over.rpe ?? null,
    skipped: over.skipped ?? false,
    skip_reason: over.skip_reason ?? null,
    prescription_item_index: over.prescription_item_index ?? null,
    movement: over.movement ?? {
      id: "mv-1",
      slug: "front-squat",
      display_name: "Front Squat",
      primary_region: "knee",
    },
  };
}

describe("optimisticLogFromFormData", () => {
  it("parses a normal weighted set", () => {
    const log = optimisticLogFromFormData(
      fd({
        sessionId: "s1",
        movementId: "mv-1",
        setKind: "main",
        weightKg: "62.5",
        reps: "5",
        prescriptionItemIndex: "2",
        rpe: "8",
      }),
      "key-1",
    );
    expect(log).toMatchObject({
      clientKey: "key-1",
      movementId: "mv-1",
      prescriptionItemIndex: 2,
      weightKg: 62.5,
      reps: 5,
      rpe: 8,
      skipped: false,
    });
  });

  it("parses a skipped set as 0/0 with the reason", () => {
    const log = optimisticLogFromFormData(
      fd({
        movementId: "mv-1",
        prescriptionItemIndex: "3",
        skipped: "true",
        skipReason: "fatigue",
        weightKg: "50",
        reps: "5",
      }),
      "key-2",
    );
    expect(log).toMatchObject({
      skipped: true,
      skipReason: "fatigue",
      weightKg: 0,
      reps: 0,
    });
  });

  it("returns null when movementId is missing", () => {
    expect(optimisticLogFromFormData(fd({ reps: "5" }), "k")).toBeNull();
  });

  it("logs a bodyweight set at 0 kg added load", () => {
    const log = optimisticLogFromFormData(
      fd({ movementId: "mv-pull", prescriptionItemIndex: "1", weightKg: "0", reps: "8" }),
      "k",
    );
    expect(log).toMatchObject({ weightKg: 0, reps: 8, skipped: false });
  });
});

describe("serverHasPendingLog", () => {
  const log: OptimisticLog = {
    clientKey: "k",
    movementId: "mv-1",
    prescriptionItemIndex: 2,
    setKind: "main",
    weightKg: 60,
    reps: 5,
    durationSec: null,
    distanceM: null,
    rpe: 8,
    skipped: false,
    skipReason: null,
  };

  it("matches a server set on (movementId, prescriptionItemIndex)", () => {
    const server = [serverSet({ id: "real-1", prescription_item_index: 2 })];
    expect(serverHasPendingLog(server, log)).toBe(true);
  });

  it("does not match a different index", () => {
    const server = [serverSet({ id: "real-1", prescription_item_index: 5 })];
    expect(serverHasPendingLog(server, log)).toBe(false);
  });

  it("does not match a different movement", () => {
    const server = [
      serverSet({
        id: "real-1",
        prescription_item_index: 2,
        movement: { id: "mv-9", slug: "x", display_name: "X", primary_region: "knee" },
      }),
    ];
    expect(serverHasPendingLog(server, log)).toBe(false);
  });

  it("never reconciles a log with no index (keeps the overlay)", () => {
    expect(serverHasPendingLog([serverSet({ id: "r" })], { ...log, prescriptionItemIndex: null })).toBe(false);
  });
});

describe("mergeOptimisticSets", () => {
  const log: OptimisticLog = {
    clientKey: "opt-1",
    movementId: "mv-1",
    prescriptionItemIndex: 2,
    setKind: "main",
    weightKg: 60,
    reps: 5,
    durationSec: null,
    distanceM: null,
    rpe: 8,
    skipped: false,
    skipReason: null,
  };

  it("returns server sets unchanged when nothing is pending", () => {
    const server = [serverSet({ id: "r1" })];
    expect(mergeOptimisticSets(server, [])).toBe(server);
  });

  it("appends a pending log the server hasn't caught up to", () => {
    const server = [serverSet({ id: "r1", prescription_item_index: 0 })];
    const merged = mergeOptimisticSets(server, [log]);
    expect(merged).toHaveLength(2);
    expect(merged[1]!.id).toBe("opt-1");
    expect(merged[1]!.movement.id).toBe("mv-1");
  });

  it("drops a pending log once the server set with the same index lands (no double-count)", () => {
    const server = [serverSet({ id: "real-1", prescription_item_index: 2 })];
    const merged = mergeOptimisticSets(server, [log]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("real-1");
  });
});

describe("pendingLogToLoggedSet", () => {
  it("maps to a LoggedSet whose movement.id is the prescribed movement (so freestyle surfaces ignore it)", () => {
    const ls = pendingLogToLoggedSet(
      {
        clientKey: "opt-x",
        movementId: "mv-7",
        prescriptionItemIndex: 0,
        setKind: "accessory",
        weightKg: 20,
        reps: 12,
        durationSec: null,
        distanceM: null,
        rpe: null,
        skipped: false,
        skipReason: null,
      },
      4,
    );
    expect(ls.id).toBe("opt-x");
    expect(ls.set_index).toBe(4);
    expect(ls.movement.id).toBe("mv-7");
    expect(ls.weight_kg).toBe(20);
    expect(ls.reps).toBe(12);
  });
});
