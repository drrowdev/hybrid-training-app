import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  RESUME_MAX_AGE_MS,
  clearResume,
  draftAppliesTo,
  isResumable,
  readResume,
  remainingRestSeconds,
  writeResume,
  type ResumeState,
} from "../session-resume";

const SESSION = "11111111-1111-4111-8111-111111111111";
const NOW = 1_700_000_000_000;

function state(over: Partial<ResumeState> = {}): ResumeState {
  return {
    sessionId: SESSION,
    activeKey: "squat",
    cursor: 2,
    savedAt: NOW,
    ...over,
  };
}

describe("remainingRestSeconds", () => {
  it("counts down from an absolute deadline", () => {
    expect(remainingRestSeconds(NOW + 90_000, NOW)).toBe(90);
  });

  it("clamps to zero once the deadline has passed", () => {
    // A rest that expired while the app was backgrounded must resume at 0,
    // not as a negative number that renders as a growing count.
    expect(remainingRestSeconds(NOW - 5_000, NOW)).toBe(0);
  });

  it("is zero when no rest was running", () => {
    expect(remainingRestSeconds(undefined, NOW)).toBe(0);
  });

  it("survives a long background gap without desyncing", () => {
    // Wall-clock, not tick-counting: 20 minutes backgrounded on a 3-minute
    // rest leaves 0, never 3 minutes.
    expect(remainingRestSeconds(NOW + 180_000, NOW + 20 * 60_000)).toBe(0);
  });
});

describe("isResumable", () => {
  it("accepts fresh state for the same session", () => {
    expect(isResumable(state(), SESSION, NOW + 1000)).toBe(true);
  });

  it("rejects a different session", () => {
    expect(isResumable(state(), "other-session", NOW)).toBe(false);
  });

  it("rejects state older than the max age", () => {
    expect(
      isResumable(state(), SESSION, NOW + RESUME_MAX_AGE_MS + 1),
    ).toBe(false);
  });

  it("rejects state from the future (clock moved backwards)", () => {
    expect(isResumable(state({ savedAt: NOW + 60_000 }), SESSION, NOW)).toBe(false);
  });

  it("rejects null", () => {
    expect(isResumable(null, SESSION, NOW)).toBe(false);
  });
});

describe("draftAppliesTo", () => {
  const withDraft = state({ draftKey: "squat", cursor: 2, draft: { weightKg: 115 } });

  it("applies to the movement and slot it was captured on", () => {
    expect(draftAppliesTo(withDraft, "squat", 2)).toBe(true);
  });

  it("does not leak onto a different movement", () => {
    // Restoring a squat's 115 kg onto a lateral raise is worse than restoring
    // nothing at all.
    expect(draftAppliesTo(withDraft, "lateral-raise", 2)).toBe(false);
  });

  it("does not leak onto a different slot of the same movement", () => {
    expect(draftAppliesTo(withDraft, "squat", 3)).toBe(false);
  });

  it("is false when there is no draft", () => {
    expect(draftAppliesTo(state({ draftKey: "squat" }), "squat", 2)).toBe(false);
  });
});

describe("readResume / writeResume round-trip", () => {
  // The suite runs in the `node` environment (vitest.config.ts), so there is
  // no DOM. Stub the one API the module touches rather than pulling in jsdom
  // for four assertions.
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const fake: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    (globalThis as { window?: unknown }).window = { localStorage: fake };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("restores what it stored", () => {
    writeResume(
      {
        sessionId: SESSION,
        activeKey: "squat",
        cursor: 3,
        draftKey: "squat",
        draft: { weightKg: 115, reps: 5 },
        restDeadlineMs: NOW + 120_000,
        restLabel: "Back Squat",
      },
      NOW,
    );
    const got = readResume(SESSION, NOW + 5_000);
    expect(got?.activeKey).toBe("squat");
    expect(got?.cursor).toBe(3);
    expect(got?.draft).toEqual({ weightKg: 115, reps: 5 });
    expect(remainingRestSeconds(got?.restDeadlineMs, NOW + 5_000)).toBe(115);
  });

  it("drops and clears stale state instead of restoring it", () => {
    writeResume({ sessionId: SESSION, activeKey: "squat" }, NOW);
    expect(readResume(SESSION, NOW + RESUME_MAX_AGE_MS + 1)).toBeNull();
    // The stale entry is evicted, not left to be re-read.
    expect(store.get(`hta.session-resume.${SESSION}`)).toBeUndefined();
  });

  it("does not restore another session's state", () => {
    writeResume({ sessionId: SESSION, activeKey: "squat" }, NOW);
    expect(readResume("22222222-2222-4222-8222-222222222222", NOW)).toBeNull();
  });

  it("clearResume removes it", () => {
    writeResume({ sessionId: SESSION, activeKey: "squat" }, NOW);
    clearResume(SESSION);
    expect(readResume(SESSION, NOW)).toBeNull();
  });

  it("survives corrupt stored JSON without throwing", () => {
    store.set(`hta.session-resume.${SESSION}`, "{not json");
    expect(() => readResume(SESSION, NOW)).not.toThrow();
    expect(readResume(SESSION, NOW)).toBeNull();
  });

  it("is a no-op when storage is unavailable", () => {
    // Private browsing throws on access; resume is a nicety, never a hard dep.
    (globalThis as { window?: unknown }).window = {
      get localStorage(): Storage {
        throw new Error("denied");
      },
    };
    expect(() => writeResume({ sessionId: SESSION, activeKey: "squat" })).not.toThrow();
    expect(readResume(SESSION, NOW)).toBeNull();
  });
});
