import { describe, expect, it } from "vitest";
import { formatRehabReps, parseRehabReps, REHAB_REPS_MAX } from "./rehab-reps";

describe("rehab rep targets", () => {
  it.each(["8-10", " 8 - 10 ", "8\u201310", "8\u201410"])(
    "DC-K4: preserves both ends of the user's rep range %j",
    (text) => {
      const result = parseRehabReps(text);
      expect(result).toEqual({
        ok: true,
        value: { reps: 8, repRange: { min: 8, max: 10 } },
      });
      if (result.ok) expect(formatRehabReps(result.value)).toBe("8-10");
    },
  );

  it.each(["10", "10-10", " 10 "])("accepts a single target %j", (text) => {
    const result = parseRehabReps(text);
    expect(result).toEqual({ ok: true, value: { reps: 10 } });
    if (result.ok) expect(formatRehabReps(result.value)).toBe("10");
  });

  it.each(["", "   "])("leaves reps empty for a hold-only movement: %j", (text) => {
    expect(parseRehabReps(text)).toEqual({ ok: true, value: {} });
    expect(formatRehabReps({})).toBe("");
  });

  it.each(["8-", "-10", "8-10-12", "ten", "8.5", "1e2", "0", "0-10", "10-8", "501", "8-501"])(
    "rejects invalid reps without changing them to a different target: %j",
    (text) => {
      expect(parseRehabReps(text)).toMatchObject({ ok: false, error: expect.any(String) });
    },
  );

  it("accepts both existing rep bounds", () => {
    expect(parseRehabReps(`1-${REHAB_REPS_MAX}`)).toEqual({
      ok: true,
      value: { reps: 1, repRange: { min: 1, max: REHAB_REPS_MAX } },
    });
  });
});
