import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  ALERT_ANNOTATION_TYPE, SWIM_ALERT_CODEBOOK, alertAnnotation, classifyAlertNodes,
  pauseBackend, projectAlertObservations, readAlertAnnotations, startBackend,
  unavailableAlert, validateAlertCategory,
} from "../../../../scripts/swim-alert-membership";

const body = {};
class SyntheticShadowRoot {
  constructor(readonly host: { localName: string; parentNode: object }) {}
}
const node = (textContent: string | null, root: object = body, id = "") => ({
  isConnected: true, textContent, id, getRootNode: () => root as Node,
});
const observation = { ...unavailableAlert("a1-pause"), category: "client-save" as const };
const annotation = alertAnnotation(observation)!;

describe("browser-only alert membership", () => {
  beforeEach(() => {
    vi.stubGlobal("ShadowRoot", SyntheticShadowRoot);
    vi.stubGlobal("document", { body });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("runs every codebook entry without a closure and returns only its closed category", () => {
    const classify = runInNewContext(`(${classifyAlertNodes.toString()})`, {
      ShadowRoot: SyntheticShadowRoot, document: { body },
    }) as typeof classifyAlertNodes;
    const literals = SWIM_ALERT_CODEBOOK.flatMap((entry) => [...entry.literals]);
    expect(new Set(literals).size).toBe(literals.length);
    for (const entry of SWIM_ALERT_CODEBOOK) {
      for (const text of entry.literals) {
        const result = classify([node(text)], SWIM_ALERT_CODEBOOK);
        expect(result).toEqual({ count: 1, category: entry.category });
        expect(validateAlertCategory(result.category)).toBe(result.category);
        expect(JSON.stringify(result)).not.toContain(text);
      }
    }
  });
  it("does not match unknown, partial, prefixed, suffixed, long or secret-bearing text", () => {
    const secret = `synthetic-private-${"x".repeat(32)}`;
    for (const entry of SWIM_ALERT_CODEBOOK) {
      for (const literal of entry.literals) {
        for (const text of [
          secret, literal.slice(1), ` ${literal}`, `${literal} `, `prefix:${literal}`,
          `${literal}:suffix`, `${literal}${secret}`, `${secret}${literal}`, literal.repeat(257),
        ]) {
          const result = classifyAlertNodes([node(text)], SWIM_ALERT_CODEBOOK);
          expect(result).toEqual({ count: 1, category: "unclassified" });
          expect(JSON.stringify(result)).not.toContain(secret);
        }
      }
    }
  });
  it("closes absent, multiple, detached and unreadable outcomes without leaking getter errors", () => {
    expect(classifyAlertNodes([], SWIM_ALERT_CODEBOOK)).toEqual({ count: 0, category: "absent" });
    expect(classifyAlertNodes([node("private-one"), node("private-two")], SWIM_ALERT_CODEBOOK)).toEqual({ count: 2, category: "multiple" });
    expect(classifyAlertNodes([{ ...node("private"), isConnected: false }], SWIM_ALERT_CODEBOOK)).toEqual({ count: 1, category: "detached" });
    expect(classifyAlertNodes([node(null)], SWIM_ALERT_CODEBOOK)).toEqual({ count: 1, category: "unreadable" });
    expect(classifyAlertNodes([{
      ...node(null), get textContent(): string { throw new Error("private-getter"); },
    }], SWIM_ALERT_CODEBOOK)).toEqual({ count: 1, category: "unreadable" });
    const detached = { ...node(null), get textContent() { this.isConnected = false; return "private-detached"; } };
    expect(classifyAlertNodes([detached], SWIM_ALERT_CODEBOOK)).toEqual({ count: 1, category: "detached" });
  });
  it("serializes structural exclusion before both count and classification, retaining every lookalike", () => {
    const classify = runInNewContext(`(${classifyAlertNodes.toString()})`, {
      ShadowRoot: SyntheticShadowRoot, document: { body },
    }) as typeof classifyAlertNodes;
    const reserved = "__next-route-announcer__";
    const next = new SyntheticShadowRoot({ localName: "next-route-announcer", parentNode: body });
    for (const titleBearing of [false, true]) {
      const announcer = node(titleBearing ? "private-title" : "", next, reserved);
      const genuine = node(SWIM_ALERT_CODEBOOK[0].literals[0]);
      expect(classify([announcer], SWIM_ALERT_CODEBOOK)).toEqual({ count: 0, category: "absent" });
      for (const alert of [
        genuine, node(genuine.textContent, { main: true }), node(genuine.textContent, body, reserved),
        node(genuine.textContent, new SyntheticShadowRoot({ localName: "other-host", parentNode: body }), reserved),
        node(genuine.textContent, next, "other-id"),
        node(genuine.textContent, new SyntheticShadowRoot({ localName: "next-route-announcer", parentNode: {} }), reserved),
        node(genuine.textContent, { host: next.host }, reserved),
      ]) {
        expect(classify([announcer, alert], SWIM_ALERT_CODEBOOK)).toEqual({ count: 1, category: "client-save" });
      }
      expect(classify([announcer, genuine, genuine], SWIM_ALERT_CODEBOOK)).toEqual({ count: 2, category: "multiple" });
      // The native negative predicate retains this node; C2's reserved-ID positive locator rejects it.
      const lookalike = node(genuine.textContent, body, reserved);
      expect(classify([lookalike], SWIM_ALERT_CODEBOOK).count).toBe(1);
      expect(lookalike.id !== reserved).toBe(false);
      expect(classify([{
        ...announcer, get textContent(): string { throw new Error("must not read announcer"); },
      }, genuine], SWIM_ALERT_CODEBOOK)).toEqual({ count: 1, category: "client-save" });
    }
  });
  it("never converts structural errors or missing browser globals into zero errors", () => {
    const broken = { ...node("private"), getRootNode(): Node { throw new Error("private-root"); } };
    expect(classifyAlertNodes([broken], SWIM_ALERT_CODEBOOK)).toEqual({ count: -1, category: "unreadable" });
    const isolated = runInNewContext(`(${classifyAlertNodes.toString()})`) as typeof classifyAlertNodes;
    expect(isolated([node("private")], SWIM_ALERT_CODEBOOK)).toEqual({ count: -1, category: "unreadable" });
    expect(JSON.stringify(classifyAlertNodes([broken], SWIM_ALERT_CODEBOOK))).not.toContain("private");
  });
  it("validates the browser enum before any serialization", () => {
    for (const value of [null, undefined, {}, [], { category: "client-save", raw: "private" }, "client", "private", "x".repeat(1000)]) {
      expect(validateAlertCategory(value)).toBe("unavailable");
      expect(alertAnnotation({ ...observation, category: value })).toBeUndefined();
    }
  });
});

describe("reserved alert annotation protocol", () => {
  it("round-trips only the ordered, bounded closed grammar and deduplicates identical observations", () => {
    expect(annotation).toEqual({
      type: ALERT_ANNOTATION_TYPE,
      description: "point=a1-pause;category=client-save;backend=unavailable;revision=unavailable",
    });
    expect(readAlertAnnotations([annotation, annotation])).toEqual([observation]);
    expect(projectAlertObservations(4, readAlertAnnotations([annotation, annotation]))).toEqual([observation]);
    expect(projectAlertObservations(3, [])).toEqual([
      unavailableAlert("c4-owner-1-start"), unavailableAlert("c4-owner-2-start"),
    ]);
    expect(projectAlertObservations(0, [observation])).toEqual([]);
  });
  it("rejects unknown keys, values, wrong casing, conflicting duplicates and oversized data", () => {
    for (const value of [
      undefined, null, {}, "private", Array(17).fill(annotation),
      [{ ...annotation, raw: "private" }],
      [{ ...annotation, description: `${annotation.description};raw=private` }],
      [{ ...annotation, description: annotation.description.replace("a1-pause", "A1-pause") }],
      [{ ...annotation, description: annotation.description.replace("client-save", "private") }],
      [{ ...annotation, description: annotation.description.replace("backend=unavailable", "backend=success") }],
      [{ ...annotation, description: annotation.description.replace("revision=unavailable", "revision=42") }],
      [{ ...annotation, description: annotation.description.replace("category=", "point=") }],
      [{ ...annotation, description: annotation.description.replace("category=", "category==") }],
      [{ ...annotation, description: "private".repeat(100) }],
      [{ ...annotation, description: null }],
      [annotation, alertAnnotation({ ...observation, category: "absent" })],
    ]) {
      expect(readAlertAnnotations(value)).toBeUndefined();
      expect(projectAlertObservations(4, readAlertAnnotations(value))).toEqual([unavailableAlert("a1-pause")]);
    }
    expect(alertAnnotation({ ...observation, raw: "private" })).toBeUndefined();
    expect(alertAnnotation({ ...observation, point: "a2-post-start", revision: "advanced" })).toBeUndefined();
    expect(projectAlertObservations(5, [observation])).toEqual([unavailableAlert("a2-post-start")]);
  });
  it("never reads unrelated descriptions, including skip, or accepts a different reserved version", () => {
    for (const type of ["skip", "private", `${ALERT_ANNOTATION_TYPE}-extra`, "hta-swim-alert-membership-v2"]) {
      expect(readAlertAnnotations([{
        type, get description() { throw new Error("must not read private text"); },
      }, annotation])).toEqual([observation]);
    }
  });
  it("reduces owned backend snapshots to closed goals and relative revisions", () => {
    expect(pauseBackend("paused", 2, 1)).toEqual({ backend: "reached", revision: "advanced" });
    expect(pauseBackend("active", 1, 1)).toEqual({ backend: "not-reached", revision: "unchanged" });
    expect(pauseBackend("active", 1, 2)).toEqual({ backend: "not-reached", revision: "other" });
    expect(pauseBackend("paused", 4, 1)).toEqual({ backend: "reached", revision: "advanced" });
    for (const value of [undefined, null, "private", NaN, Infinity, -1, 0, 1.5, {}]) {
      expect(pauseBackend("paused", value, 1)).toEqual({ backend: "unavailable", revision: "unavailable" });
      expect(pauseBackend("paused", 1, value)).toEqual({ backend: "unavailable", revision: "unavailable" });
    }
    expect(pauseBackend("private-status", 1, 1)).toEqual({ backend: "unavailable", revision: "unavailable" });
    expect(startBackend("started", "private-session")).toBe("reached");
    expect(startBackend("scheduled", null)).toBe("not-reached");
    expect(startBackend("started", "")).toBe("not-reached");
    expect(startBackend("private-status", null)).toBe("unavailable");
    expect(startBackend("started", undefined)).toBe("unavailable");
  });
});
