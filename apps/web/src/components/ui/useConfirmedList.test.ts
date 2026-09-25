import { describe, expect, it } from "vitest";
import { confirmedList, reconcileConfirmedChanges, type ConfirmedChanges } from "./useConfirmedList";

describe("confirmed list changes", () => {
  const first = { id: "first", name: "First" };
  const second = { id: "second", name: "Second" };

  it("leaves server data unchanged without a confirmed change", () => {
    const source = [first, second];
    expect(confirmedList(source, { added: [], removed: [] })).toEqual(source);
  });

  it("keeps confirmed deletion hidden across stale refreshes until acknowledged", () => {
    let changes: ConfirmedChanges<typeof first> = { added: [], removed: [first.id] };
    changes = reconcileConfirmedChanges([first, second], changes);
    expect(confirmedList([first, second], changes)).toEqual([second]);
    changes = reconcileConfirmedChanges([second], changes);
    expect(changes.removed).toEqual([]);
    // A subsequent server-confirmed restore is authoritative.
    expect(confirmedList([first, second], changes)).toEqual([first, second]);
  });

  it("fills the creation gap, then uses the server row without duplication", () => {
    let changes = { added: [first], removed: [] as string[] };
    changes = reconcileConfirmedChanges([], changes);
    expect(confirmedList([], changes)).toEqual([first]);
    const canonical = { ...first, name: "Changed elsewhere" };
    expect(confirmedList([canonical], changes)).toEqual([canonical]);
    changes = reconcileConfirmedChanges([canonical], changes);
    expect(changes.added).toEqual([]);
    expect(confirmedList([], changes)).toEqual([]);
  });

  it("reconciles independent confirmations without losing the other pending row", () => {
    const changes = reconcileConfirmedChanges([first], { added: [first, second], removed: [] });
    expect(changes.added).toEqual([second]);
    expect(confirmedList([first], changes)).toHaveLength(2);
  });
});
