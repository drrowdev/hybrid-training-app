import { describe, expect, it } from "vitest";
import { formatPoolLengthInput, parsePoolLengthInput } from "./swim-pool-input";

describe("DC-SW1 readable exact pool lengths", () => {
  it.each([
    ["25", 25, 1],
    ["25.00000", 25, 1],
    ["33.33", 3333, 100],
    ["33 1/3", 100, 3],
    [" 100 / 3 ", 100, 3],
  ])("parses %s without rounding", (text, numerator, denominator) => {
    expect(parsePoolLengthInput(String(text), "m")).toEqual({
      ok: true, value: { numerator, denominator, unit: "m" },
    });
  });

  it("keeps the chosen native unit", () => {
    expect(parsePoolLengthInput("25", "yd")).toEqual({
      ok: true, value: { numerator: 25, denominator: 1, unit: "yd" },
    });
  });

  it.each(["", "-25", "0", "1/0", "33 4/3", "25 metres", "2e1", "33.333333333333333", "9".repeat(65)])(
    "rejects invalid or unrepresentable input %s", (text) => {
      expect(parsePoolLengthInput(text, "m").ok).toBe(false);
    },
  );

  it.each(["25", "33.33", "100/3"])("round-trips %s through the editable label", (text) => {
    const parsed = parsePoolLengthInput(text, "yd");
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(formatPoolLengthInput(parsed.value)).toBe(text);
    expect(parsePoolLengthInput(formatPoolLengthInput(parsed.value), "yd")).toEqual(parsed);
  });

  it("does not format a malformed course as an editable value", () => {
    expect(() => formatPoolLengthInput({ numerator: 25, denominator: 0, unit: "m" })).toThrow();
  });
});
