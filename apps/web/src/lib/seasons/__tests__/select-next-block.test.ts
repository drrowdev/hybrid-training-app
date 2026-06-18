/**
 * Season descriptor + next-block selection tests (ADR 0051 A2–A5).
 *
 * The selection function is a pure CP-1 heuristic; these tests pin its INTENT
 * (a strength-bias slot proposes strength-leaning options; an endurance slot
 * proposes the engine-builders; recency demotes the just-run option; an event
 * prefers an arc) rather than exact scores, so the heuristics can be retuned
 * without churning the suite.
 */
import { describe, it, expect } from "vitest";
import {
  getDescriptor,
  isArcProgram,
  listCandidateDescriptors,
} from "../descriptors";
import { emphasisToSlot, selectNextBlock } from "../select-next-block";

describe("descriptors", () => {
  it("resolves a template-level descriptor exactly", () => {
    const d = getDescriptor("tactical-barbell", "zulu");
    expect(d).not.toBeNull();
    expect(d!.volumeBand).toBe("high");
  });

  it("falls back to the program default for an unknown template", () => {
    const d = getDescriptor("tactical-barbell", "does-not-exist");
    expect(d).not.toBeNull(); // falls back to a TB entry
  });

  it("returns null for an unknown program", () => {
    expect(getDescriptor("not-a-program")).toBeNull();
  });

  it("flags arc programs (Green Protocol, HYROX) and not block ones", () => {
    expect(isArcProgram("green-protocol")).toBe(true);
    expect(isArcProgram("hyrox")).toBe(true);
    expect(isArcProgram("hybrid")).toBe(false);
    expect(isArcProgram("tactical-barbell")).toBe(false);
  });

  it("enumerates a non-empty candidate catalogue", () => {
    expect(listCandidateDescriptors().length).toBeGreaterThan(5);
  });
});

describe("emphasisToSlot", () => {
  it("maps strength_bias to a strength-concentrated slot", () => {
    const slot = emphasisToSlot("strength_bias");
    expect(slot.biased).toBe("strength");
    expect(slot.arcRole).toBe("intensification");
    expect(slot.desired.strength).toBeGreaterThan(slot.desired.endurance ?? 0);
  });

  it("maps endurance_bias to an endurance-concentrated slot", () => {
    const slot = emphasisToSlot("endurance_bias");
    expect(slot.biased).toBe("endurance");
    expect(slot.desired.endurance ?? 0).toBeGreaterThan(slot.desired.strength ?? 0);
  });

  it("maps recovery to a maintenance slot with no bias", () => {
    const slot = emphasisToSlot("recovery");
    expect(slot.arcRole).toBe("maintenance");
    expect(slot.biased).toBeNull();
  });
});

describe("selectNextBlock", () => {
  it("proposes a strength-leaning option for a strength-bias slot", () => {
    const res = selectNextBlock(emphasisToSlot("strength_bias"));
    expect(res.top).not.toBeNull();
    // Top pick is a strength program (5/3/1 or Tactical Barbell), not HYROX.
    expect(["wendler-531", "tactical-barbell"]).toContain(res.top!.candidate.programId);
  });

  it("proposes an engine-builder for an endurance-bias slot", () => {
    const res = selectNextBlock(emphasisToSlot("endurance_bias"));
    expect(res.top).not.toBeNull();
    expect(["green-protocol", "hyrox", "hybrid"]).toContain(res.top!.candidate.programId);
  });

  it("down-weights the template just run (anti-staleness)", () => {
    const slot = emphasisToSlot("strength_bias");
    const fresh = selectNextBlock(slot);
    const topId = fresh.top!.candidate;
    // Re-run telling the planner that exact option was just used.
    const after = selectNextBlock(slot, {
      lastProgramId: topId.programId,
      lastTemplateRef: topId.templateRef,
    });
    const sameInAfter = after.ranked.find(
      (r) =>
        r.candidate.programId === topId.programId &&
        r.candidate.templateRef === topId.templateRef,
    )!;
    const sameInFresh = fresh.ranked.find(
      (r) =>
        r.candidate.programId === topId.programId &&
        r.candidate.templateRef === topId.templateRef,
    )!;
    expect(sameInAfter.score).toBeLessThan(sameInFresh.score);
  });

  it("prefers an arc program near an A-event", () => {
    const slot = emphasisToSlot("peak");
    const res = selectNextBlock(slot, { nearEvent: true });
    expect(res.top).not.toBeNull();
    expect(isArcProgram(res.top!.candidate.programId)).toBe(true);
  });

  it("returns a ranking with a plain-English reason on the top pick", () => {
    const res = selectNextBlock(emphasisToSlot("strength_bias"));
    expect(res.ranked.length).toBeGreaterThan(1);
    expect(typeof res.top!.reason).toBe("string");
    expect(res.top!.reason.length).toBeGreaterThan(10);
  });
});
