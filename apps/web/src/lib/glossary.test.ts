/**
 * Glossary shape + brand-purity tests.
 *
 * Ensures every entry has a non-empty title and body, bodies stay
 * within tooltip-friendly length, the helper round-trips known terms
 * and rejects unknown ones, and — most importantly — no entry
 * references an external program / methodology name (DC-Q6).
 */
import { describe, it, expect } from "vitest";
import { GLOSSARY, getGlossaryEntry } from "./glossary";

// External program / methodology names that must never appear in
// any glossary entry. Research citations (Banister, Gabbett, Seiler,
// Schoenfeld, Israetel, Epley, Brzycki) are explicitly allowed because
// they are people, not products.
const BRAND_BLOCKLIST = [
  "Wendler",
  "5/3/1",
  "531",
  "Cube",
  "RTS",
  "Renaissance Periodization",
  "Juggernaut",
  "Sheiko",
  "Smolov",
  "StrongLifts",
  "Starting Strength",
  "Greyskull",
  "nSuns",
  "Texas Method",
  "Madcow",
  "Westside",
  "Conjugate",
];

describe("GLOSSARY", () => {
  it("has at least 25 entries", () => {
    expect(Object.keys(GLOSSARY).length).toBeGreaterThanOrEqual(25);
  });

  it("every entry has a non-empty title and body", () => {
    for (const [term, entry] of Object.entries(GLOSSARY)) {
      expect(entry.title, `${term} title`).toBeTruthy();
      expect(entry.title.length, `${term} title length`).toBeGreaterThan(0);
      expect(entry.body, `${term} body`).toBeTruthy();
      expect(entry.body.length, `${term} body length`).toBeGreaterThan(0);
    }
  });

  it("bodies are under 280 characters (tooltip-readable)", () => {
    for (const [term, entry] of Object.entries(GLOSSARY)) {
      expect(entry.body.length, `${term} body too long`).toBeLessThan(280);
    }
  });

  it("terms use kebab/snake_case ids only", () => {
    for (const term of Object.keys(GLOSSARY)) {
      expect(term).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("contains no external program / methodology names (DC-Q6)", () => {
    for (const [term, entry] of Object.entries(GLOSSARY)) {
      const haystack = `${entry.title} ${entry.body} ${entry.citation ?? ""}`;
      for (const banned of BRAND_BLOCKLIST) {
        // Case-insensitive whole-word check — "Cube" must not appear,
        // but "cubed" in some hypothetical future entry wouldn't false-
        // positive.
        const re = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
        expect(re.test(haystack), `${term} contains banned name "${banned}"`).toBe(false);
      }
    }
  });
});

describe("getGlossaryEntry", () => {
  it("returns the entry for a known term", () => {
    const e = getGlossaryEntry("ceiling");
    expect(e).not.toBeNull();
    expect(e?.title).toMatch(/ceiling/i);
  });

  it("returns null for an unknown term", () => {
    expect(getGlossaryEntry("not_a_real_term")).toBeNull();
  });

  it("does not throw on prototype-pollution-style lookups", () => {
    expect(getGlossaryEntry("toString")).toBeNull();
    expect(getGlossaryEntry("__proto__")).toBeNull();
    expect(getGlossaryEntry("constructor")).toBeNull();
  });
});
