/**
 * Glossary shape tests.
 *
 * Ensures every entry has a non-empty title and body, bodies stay
 * within tooltip-friendly length, and the helper round-trips known
 * terms and rejects unknown ones.
 */
import { describe, it, expect } from "vitest";
import { GLOSSARY, getGlossaryEntry } from "./glossary";

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

  it("has a populated two_a_day entry (cites Robineau)", () => {
    const e = getGlossaryEntry("two_a_day");
    expect(e).not.toBeNull();
    expect(e?.title).toBeTruthy();
    expect(e?.title.length).toBeGreaterThan(0);
    expect(e?.body).toBeTruthy();
    expect(e?.body.length).toBeGreaterThan(0);
    expect(e?.citation).toMatch(/Robineau/i);
  });
});
