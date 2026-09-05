import { describe, expect, it } from "vitest";
import { formatSwimTime, parseSwimTime } from "../time";

describe("ADR0079 native manual swimming times", () => {
  it("retains integer milliseconds on a round trip", () => {
    for (const time of [1, 12345, 120001, 3599999, 86400000]) {
      expect(parseSwimTime(formatSwimTime(time))).toBe(time);
    }
    expect(parseSwimTime("2:03.4")).toBe(123400);
  });
  it.each(["1.5", "1:60", "-1:30", "0:00", "NaN", "1:00.1234", "1440:01"])(
    "rejects %s instead of rounding or guessing",
    (value) => expect(() => parseSwimTime(value)).toThrow(),
  );
});
