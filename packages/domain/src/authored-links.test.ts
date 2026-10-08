import { describe, expect, it } from "vitest";
import { compileAuthoredWorkout, type AuthoredMovement, type AuthoredWeek, type AuthoredWorkout, type AuthoredWorkoutPart } from "./authored-program";
import {
  authoredLinkGroups, canLinkAuthoredPart, defaultLinkName, MAX_LINK_MEMBERS, moveAuthoredPart, removeAuthoredPart, setAuthoredPartLinked,
} from "./authored-links";

const catalog = [
  { id: "bench", slug: "bench", displayName: "Bench press", pattern: "press" },
  { id: "row", slug: "row", displayName: "Row", pattern: "pull" },
  { id: "curl", slug: "curl", displayName: "Curl", pattern: "pull" },
  { id: "run", slug: "run", displayName: "Running", pattern: "cardio", modality: "run" },
];
const weeks: AuthoredWeek[] = [
  { type: "Build", sets: "3", reps: "5", pct: 75 },
  { type: "Deload", sets: "3", reps: "5", pct: 70, fewer: true },
  { type: "Test", sets: "1", reps: "3", pct: 90, after: "updateFromLoggedSet" },
];
const movement = (id: string, movementId: string, role: AuthoredMovement["role"], sets: string, extra: Partial<AuthoredMovement> = {}): AuthoredMovement => ({
  id, movementId, role, sets, dose: { kind: "reps", reps: "8" }, load: { kind: "rir", value: "2" }, restSeconds: 90, notes: "", ...extra,
});
const part = (id: string, m: AuthoredMovement, linkNext?: true): AuthoredWorkoutPart => ({ id, kind: "movement", movement: m, ...(linkNext ? { linkNext } : {}) });
const day = (parts: AuthoredWorkoutPart[]): AuthoredWorkout => ({ id: "d", name: "Day", weekday: 0, parts });
const compile = (parts: AuthoredWorkoutPart[], week = 0) => compileAuthoredWorkout(day(parts), catalog, undefined, weeks[week], week).items;

describe("DC-K4 authored exercise links", () => {
  const a = movement("a", "bench", "accessory", "3");
  const b = movement("b", "row", "accessory", "3");

  it("emits circuit metadata for linked exercises that keep their own sets", () => {
    const items = compile([part("pa", a, true), part("pb", b)]);
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.circuit)).toEqual([
      ...[0, 1, 2].map((round) => ({ id: "pa:link", name: "Superset", position: 0, size: 2, rounds: 3, round })),
      ...[0, 1, 2].map((round) => ({ id: "pa:link", name: "Superset", position: 1, size: 2, rounds: 3, round })),
    ]);
    expect(items.every((item) => item.reps === 8 && item.targetRir && item.meta.restSeconds === 90)).toBe(true);
    expect(items.map((item) => item.meta.authoredPartId)).toEqual(["pa", "pa", "pa", "pb", "pb", "pb"]);
  });

  it("names tri-sets and giant sets by member count", () => {
    const c = movement("c", "curl", "accessory", "3");
    expect(compile([part("pa", a, true), part("pb", b, true), part("pc", c)])[0]?.circuit).toMatchObject({ name: "Tri-set", size: 3 });
    expect(defaultLinkName(4)).toBe("Giant set");
  });

  it("DC-K4 rotates the shortest member's sets and logs the rest solo", () => {
    const items = compile([part("pa", movement("a", "bench", "accessory", "4"), true), part("pb", movement("b", "row", "accessory", "2"))]);
    const first = items.filter((item) => item.meta.authoredPartId === "pa");
    expect(first).toHaveLength(4);
    expect(first.map((item) => item.circuit?.round)).toEqual([0, 1, undefined, undefined]);
    expect(first[0]?.circuit?.rounds).toBe(2);
    expect(items.filter((item) => item.meta.authoredPartId === "pb").every((item) => item.circuit?.rounds === 2)).toBe(true);
  });

  it("DC-K4 keeps deload, week overrides and test-week behaviour per member", () => {
    const main = movement("a", "bench", "main", "3", { load: { kind: "pct", value: 75 }, dose: { kind: "reps", reps: "5" } });
    const acc = movement("b", "row", "accessory", "3", { overrides: { "1": { sets: "2" } } });
    const deload = compile([part("pa", main, true), part("pb", acc)], 1);
    expect(deload.filter((item) => item.meta.authoredPartId === "pa")).toHaveLength(3);
    expect(deload.filter((item) => item.meta.authoredPartId === "pb")).toHaveLength(2);
    expect(deload[0]?.circuit?.rounds).toBe(2);
    const accDeload = compile([part("pa", main, true), part("pb", movement("b", "row", "accessory", "3"))], 1);
    expect(accDeload.filter((item) => item.meta.authoredPartId === "pb")).toHaveLength(2);
    const test = compile([part("pa", main, true), part("pb", acc)], 2);
    expect(test.find((item) => item.meta.authoredPartId === "pa")).toMatchObject({ percentTm: 90, meta: { authoredTest: { after: "updateFromLoggedSet" } } });
  });

  it("restores solo output when unlinked and leaves old definitions unchanged", () => {
    const linked = [part("pa", a, true), part("pb", b)];
    const unlinked = setAuthoredPartLinked(linked, 0, false);
    expect(unlinked[0]).not.toHaveProperty("linkNext");
    const solo = compile(unlinked);
    expect(solo.every((item) => item.circuit === undefined && item.meta.authoredLink === undefined)).toBe(true);
    expect(compile([part("pa", a), part("pb", b)])).toEqual(solo);
  });

  it("never links stale flags, a lone member or non-exercise parts", () => {
    expect(compile([part("pa", a, true)]).every((item) => item.circuit === undefined)).toBe(true);
    const rehab: AuthoredWorkoutPart = { id: "rh", kind: "rehab", protocolId: "p" };
    expect(authoredLinkGroups([part("pa", a, true), rehab]).map((group) => group.length)).toEqual([1, 1]);
  });
});

describe("authored link editing", () => {
  const parts = ["a", "b", "c", "d"].map((id) => part(id, movement(id, "bench", "accessory", "3")));
  const shape = (list: readonly AuthoredWorkoutPart[]) => authoredLinkGroups(list).map((group) => group.map((entry) => entry.id).join(""));

  it("links and unlinks adjacent exercises", () => {
    const linked = setAuthoredPartLinked(setAuthoredPartLinked(parts, 0, true), 1, true);
    expect(shape(linked)).toEqual(["abc", "d"]);
    expect(shape(setAuthoredPartLinked(linked, 1, false))).toEqual(["ab", "c", "d"]);
    expect(canLinkAuthoredPart(parts, 3)).toBe(false);
  });

  it("caps a link at the member limit", () => {
    const many = Array.from({ length: MAX_LINK_MEMBERS + 1 }, (_, i) => part(`p${i}`, movement(`p${i}`, "bench", "accessory", "3")));
    const full = many.slice(0, -1).reduce<AuthoredWorkoutPart[]>((list, _entry, i) => i < MAX_LINK_MEMBERS - 1 ? setAuthoredPartLinked(list, i, true) : list, many);
    expect(authoredLinkGroups(full)[0]).toHaveLength(MAX_LINK_MEMBERS);
    expect(canLinkAuthoredPart(full, MAX_LINK_MEMBERS - 1)).toBe(false);
  });

  it("removing a member keeps or dissolves the group", () => {
    const abc = setAuthoredPartLinked(setAuthoredPartLinked(parts, 0, true), 1, true);
    expect(shape(removeAuthoredPart(abc, "b"))).toEqual(["ac", "d"]);
    expect(shape(removeAuthoredPart(abc, "c"))).toEqual(["ab", "d"]);
    expect(shape(removeAuthoredPart(abc, "a"))).toEqual(["bc", "d"]);
    const ab = setAuthoredPartLinked(parts, 0, true);
    expect(shape(removeAuthoredPart(ab, "b"))).toEqual(["a", "c", "d"]);
    expect(removeAuthoredPart(ab, "b")[0]).not.toHaveProperty("linkNext");
  });

  it("moves members inside a link and whole links past neighbours without splitting", () => {
    const ab = setAuthoredPartLinked(parts, 0, true);
    expect(shape(moveAuthoredPart(ab, 1, -1))).toEqual(["ba", "c", "d"]);
    expect(moveAuthoredPart(ab, 1, -1).map((entry) => entry.id)).toEqual(["b", "a", "c", "d"]);
    expect(shape(moveAuthoredPart(ab, 1, 1))).toEqual(["c", "ab", "d"]);
    expect(shape(moveAuthoredPart(ab, 2, -1))).toEqual(["c", "ab", "d"]);
    expect(shape(moveAuthoredPart(ab, 0, -1))).toEqual(["ab", "c", "d"]);
  });
});
