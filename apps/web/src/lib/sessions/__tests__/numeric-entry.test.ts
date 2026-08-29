/**
 * Reading a number out of a field the user is still typing in.
 *
 * Reported as: "I couldn't write 27,5 kg for the db row. It only accepted full
 * numbers and no decimals."
 */
import { describe, it, expect } from "vitest";
import { isPartialNumber, parsePartialNumber } from "../numeric-entry";

describe("parsePartialNumber", () => {
  it("reads a decimal typed with either separator", () => {
    expect(parsePartialNumber("27.5")).toBe(27.5);
    expect(parsePartialNumber("27,5")).toBe(27.5);
  });

  it("survives the halfway state that used to erase the decimal", () => {
    // The old field committed Number("27.") = 27 and re-rendered from the
    // number, so the dot vanished and the next keystroke gave 275. Every
    // prefix of "27,5" has to be a state the field can sit in.
    expect(parsePartialNumber("2")).toBe(2);
    expect(parsePartialNumber("27")).toBe(27);
    expect(parsePartialNumber("27,")).toBe(27);
    expect(parsePartialNumber("27.")).toBe(27);
    expect(parsePartialNumber("27,5")).toBe(27.5);
  });

  it("reads a bare separator and an empty field as zero", () => {
    // The committed number must never disagree with what is on screen, or
    // "Log set" would record something the lifter cannot see.
    expect(parsePartialNumber("")).toBe(0);
    expect(parsePartialNumber(",5")).toBe(0.5);
    expect(parsePartialNumber(".")).toBe(0);
  });

  it("refuses what Number() would silently accept", () => {
    // Number("0x1f") is 31 and Number(" 12 ") is 12. Neither is something a
    // weight field should take.
    for (const text of ["0x1f", "1e3", " 12 ", "12 5", "-5", "+5", "Infinity"]) {
      expect(parsePartialNumber(text), text).toBeNull();
    }
  });

  it("refuses two separators and stray characters", () => {
    for (const text of ["27,,5", "27.5.5", "27,5,5", "2a7", "27kg"]) {
      expect(parsePartialNumber(text), text).toBeNull();
    }
  });

  it("takes no separator at all in an integer field", () => {
    // Reps and seconds are whole. Accepting "2,5" there would round to 3.
    expect(parsePartialNumber("8", true)).toBe(8);
    expect(parsePartialNumber("8,5", true)).toBeNull();
    expect(parsePartialNumber("8.5", true)).toBeNull();
  });
});

describe("isPartialNumber", () => {
  it("allows a field to be emptied and retyped", () => {
    expect(isPartialNumber("")).toBe(true);
    expect(isPartialNumber("", true)).toBe(true);
  });

  it("gates the keystroke rather than stripping the text", () => {
    // A rejected keystroke leaves the previous text alone. Stripping in place
    // would turn "2a7" into "27", which is worse than the "a" not appearing.
    expect(isPartialNumber("2a7")).toBe(false);
    expect(isPartialNumber("27,5")).toBe(true);
  });
});
