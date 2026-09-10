import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  ALERT_ANNOTATION_TYPE, SWIM_ALERT_CODEBOOK, a4ReplayBackend, alertAnnotation, classifyAlertNodes, classifyWorkoutViewNodes,
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
  it("round-trips both A4 points only at index21, with transport values confined to the transport point", () => {
    const replay = { ...unavailableAlert("a4-replay"), category: "client-queue" as const,
      backend: "reached" as const, control: "log" as const, result: "editing" as const };
    for (const result of ["request-unseen", "request-pending", "request-failed", "http-2xx", "http-3xx", "http-4xx", "http-5xx", "unavailable"] as const) {
      const transport = { ...unavailableAlert("a4-replay-transport"), result };
      const encoded = [alertAnnotation(replay)!, alertAnnotation(transport)!];
      for (const value of encoded) expect(value.description.length).toBeLessThanOrEqual(160);
      expect(readAlertAnnotations(encoded)).toEqual([replay, transport]);
      expect(projectAlertObservations(21, readAlertAnnotations([...encoded].reverse()))).toEqual([replay, transport]);
      expect(projectAlertObservations(21, [transport])).toEqual([unavailableAlert("a4-replay"), transport]);
      for (let index = 0; index < 21; index++) {
        expect(projectAlertObservations(index, [replay, transport])).toEqual(projectAlertObservations(index, undefined));
      }
      for (const point of ["a1-pause", "a2-post-start", "a2-edit", "c4-owner-1-start", "c4-owner-2-start", "a4-replay"] as const) {
        expect(!!alertAnnotation({ ...unavailableAlert(point), result })).toBe(result === "unavailable");
      }
      for (const [field, value] of [
        ["category", "absent"], ["backend", "reached"], ["backend", "not-reached"],
        ["revision", "unchanged"], ["control", "none"], ["control", "account-page"], ["result", "summary"],
      ]) {
        expect(alertAnnotation({ ...transport, [field!]: value })).toBeUndefined();
        expect(readAlertAnnotations([{ ...encoded[1],
          description: encoded[1]!.description.replace(`${field}=${transport[field as keyof typeof transport]}`, `${field}=${value}`),
        }])).toBeUndefined();
      }
      expect(readAlertAnnotations(Array(16).fill(encoded[1]))).toEqual([transport]);
      expect(readAlertAnnotations(Array(17).fill(encoded[1]))).toBeUndefined();
    }
    for (const control of ["start", "log", "plan-inactive", "removed", "unavailable-page", "not-found", "none", "unavailable"]) {
      for (const result of ["editing", "summary", "none", "unavailable"]) {
        const value = { ...replay, control, result };
        expect(readAlertAnnotations([alertAnnotation(value)])).toEqual([value]);
      }
    }
  });
  it.each(["a4-replay", "a4-replay-transport"] as const)("fails closed on hostile %s observations", (point) => {
    const value = unavailableAlert(point);
    const encoded = alertAnnotation(value)!;
    const secret = `synthetic-secret-${"x".repeat(32)}`;
    for (const field of ["point", "category", "backend", "revision", "control", "result"]) {
      for (const invalid of [secret, "", undefined, null, {}, 42, `${value[field as keyof typeof value]};raw=${secret}`]) {
        expect(alertAnnotation({ ...value, [field]: invalid })).toBeUndefined();
        expect(readAlertAnnotations([{ ...encoded, description: encoded.description.replace(
          `${field}=${value[field as keyof typeof value]}`, `${field}=${String(invalid)}`,
        ) }])).toBeUndefined();
      }
    }
    for (const bad of [
      { ...encoded, raw: secret },
      { ...encoded, description: `${encoded.description};raw=${secret}` },
      { ...encoded, description: encoded.description.replace(point, "a4-other") },
      { ...encoded, description: encoded.description.replace("revision=unavailable", "revision=advanced") },
      { ...encoded, description: encoded.description.repeat(16) },
    ]) {
      expect(readAlertAnnotations([encoded, bad])).toBeUndefined();
      expect(projectAlertObservations(21, readAlertAnnotations([encoded, bad]))).toEqual([
        unavailableAlert("a4-replay"), unavailableAlert("a4-replay-transport"),
      ]);
    }
    expect(alertAnnotation({ ...value, raw: secret })).toBeUndefined();
    for (const observations of [[observation], [value, observation]]) {
      expect(projectAlertObservations(21, observations)).toEqual([
        unavailableAlert("a4-replay"), unavailableAlert("a4-replay-transport"),
      ]);
    }
  });
  it("DC-SW8: reaches A4 only for the exact synthetic session receipt and a valid completion timestamp", () => {
    const row = { id: "session", user_id: "owner", completion_outbox_entry_id: "receipt", completed_at: "2026-09-10T00:00:00Z" };
    expect(a4ReplayBackend(row, null, "owner", "session", "receipt")).toBe("reached");
    for (const value of [
      { ...row, completion_outbox_entry_id: null, completed_at: null },
      { ...row, completion_outbox_entry_id: "other" }, { ...row, completed_at: null },
    ]) expect(a4ReplayBackend(value, null, "owner", "session", "receipt")).toBe("not-reached");
    for (const value of [
      null, undefined, {}, [], { ...row, id: "other" }, { ...row, user_id: "other" },
      { ...row, completion_outbox_entry_id: 1 }, { ...row, completed_at: "private-error" },
      { ...row, completed_at: 1 }, { ...row, get completed_at() { throw new Error("private-row"); } },
    ]) expect(a4ReplayBackend(value, null, "owner", "session", "receipt")).toBe("unavailable");
    for (const error of [{ message: "private-error" }, undefined, { get message() { throw new Error("private-error"); } }]) {
      expect(a4ReplayBackend(row, error, "owner", "session", "receipt")).toBe("unavailable");
    }
    expect(a4ReplayBackend(row, null, "owner", "session", "")).toBe("unavailable");
  });
  it("round-trips only the ordered, bounded closed grammar and deduplicates identical observations", () => {
    expect(annotation).toEqual({
      type: ALERT_ANNOTATION_TYPE,
      description: "point=a1-pause;category=client-save;backend=unavailable;revision=unavailable;control=unavailable;result=unavailable",
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
    expect(projectAlertObservations(5, [observation])).toEqual([
      unavailableAlert("a2-post-start"), unavailableAlert("a2-edit"),
    ]);
  });
  it.each(["a2-post-start", "a2-edit"] as const)("validates %s without inventing a submitted revision", (point) => {
    const value = { ...unavailableAlert(point), category: "server-fixed" as const, backend: "reached" as const };
    const encoded = alertAnnotation(value)!;
    expect(readAlertAnnotations([encoded, encoded])).toEqual([value]);
    expect(projectAlertObservations(5, readAlertAnnotations([encoded, encoded]))).toEqual(
      (["a2-post-start", "a2-edit"] as const).map((item) => item === point ? value : unavailableAlert(item)),
    );
    for (const revision of ["unchanged", "advanced", "other", 42, "private-revision"]) {
      expect(alertAnnotation({ ...value, revision })).toBeUndefined();
    }
    for (const hostile of [
      { ...encoded, raw: "private-payload" },
      { ...encoded, description: encoded.description.replace(point, point.toUpperCase()) },
      { ...encoded, description: encoded.description.replace(point, "a2-other") },
      { ...encoded, description: encoded.description.replace("server-fixed", "private-payload") },
      { ...encoded, description: `${encoded.description};raw=private-payload` },
      { ...encoded, description: `${encoded.description};point=${point}` },
      { ...encoded, description: encoded.description.repeat(100) },
      { ...encoded, description: encoded.description.replace("revision=unavailable", "revision=advanced") },
      alertAnnotation({ ...value, category: "absent" }),
    ]) {
      expect(readAlertAnnotations([encoded, hostile])).toBeUndefined();
      expect(projectAlertObservations(5, readAlertAnnotations([encoded, hostile]))).toEqual([
        unavailableAlert("a2-post-start"), unavailableAlert("a2-edit"),
      ]);
    }
    for (const index of [3, 4]) {
      expect(projectAlertObservations(index, [value])).toEqual(projectAlertObservations(index, undefined));
    }
  });
  it("projects both A2 points in order with unavailable defaults and no cross-case evidence", () => {
    const start = { ...unavailableAlert("a2-post-start"), category: "absent" as const, backend: "reached" as const };
    const edit = { ...unavailableAlert("a2-edit"), category: "client-save" as const, backend: "not-reached" as const };
    expect(projectAlertObservations(5, readAlertAnnotations([
      alertAnnotation(edit), alertAnnotation(start), alertAnnotation(edit), alertAnnotation(start),
    ]))).toEqual([start, edit]);
    for (const values of [undefined, [], [observation], [start, edit, observation]]) {
      expect(projectAlertObservations(5, values)).toEqual([
        unavailableAlert("a2-post-start"), unavailableAlert("a2-edit"),
      ]);
    }
  });
  it("never reads unrelated descriptions, including skip, or accepts a different reserved version", () => {
    for (const type of ["skip", "private", `${ALERT_ANNOTATION_TYPE}-extra`, "hta-swim-alert-membership-v1"]) {
      expect(readAlertAnnotations([{
        type, get description() { throw new Error("must not read private text"); },
      }, annotation])).toEqual([observation]);
    }
  });
  it("round-trips every v2 view enum separately from the frozen category vocabulary within the existing caps", () => {
    expect(ALERT_ANNOTATION_TYPE).toBe("hta-swim-alert-membership-v2");
    for (const control of ["start", "log", "plan-inactive", "removed", "unavailable-page", "not-found", "none", "unavailable"]) {
      for (const result of ["editing", "summary", "none", "unavailable"]) {
        const value = { ...unavailableAlert("a2-post-start"), control, result };
        const encoded = alertAnnotation(value)!;
        expect(encoded.description.length).toBeLessThanOrEqual(160);
        expect(encoded.description.split(";").map((part) => part.split("=")[0])).toEqual(
          ["point", "category", "backend", "revision", "control", "result"],
        );
        expect(readAlertAnnotations(Array(16).fill(encoded))).toEqual([value]);
        expect(readAlertAnnotations(Array(17).fill(encoded))).toBeUndefined();
      }
    }
    const longest = alertAnnotation({ ...unavailableAlert("c4-owner-1-start"),
      category: "server-validation", control: "unavailable-page" })!;
    expect(longest.description.length).toBeLessThanOrEqual(160);
    for (const point of ["a1-pause", "a2-post-start", "a2-edit", "c4-owner-1-start", "c4-owner-2-start"] as const) {
      expect(unavailableAlert(point)).toEqual({ point, category: "unavailable", backend: "unavailable",
        revision: "unavailable", control: "unavailable", result: "unavailable" });
    }
  });
  it.each(["control", "result"] as const)("fails closed on missing, hostile, reordered or conflicting %s metadata", (field) => {
    for (const value of [undefined, null, false, {}, [], 0, "private-payload", "START", "Summary", "unavailable ", "none;raw=private"]) {
      expect(alertAnnotation({ ...observation, [field]: value })).toBeUndefined();
      const invalid = { ...annotation, description: annotation.description.replace(`${field}=unavailable`, `${field}=${String(value)}`) };
      expect(readAlertAnnotations([invalid])).toBeUndefined();
      expect(projectAlertObservations(4, readAlertAnnotations([invalid]))).toEqual([unavailableAlert("a1-pause")]);
    }
    const missing = { ...observation };
    Reflect.deleteProperty(missing, field);
    expect(alertAnnotation(missing)).toBeUndefined();
    const parts = annotation.description.split(";");
    for (let i = 0; i < parts.length - 1; i++) {
      const reordered = [...parts];
      [reordered[i], reordered[i + 1]] = [reordered[i + 1]!, reordered[i]!];
      expect(readAlertAnnotations([{ ...annotation, description: reordered.join(";") }])).toBeUndefined();
    }
    expect(readAlertAnnotations([annotation, alertAnnotation({ ...observation, [field]: "none" })])).toBeUndefined();
    expect(validateAlertCategory("editing")).toBe("unavailable");
    expect(validateAlertCategory("plan-inactive")).toBe("unavailable");
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

  describe("DC-SW9 tracked visible workout branches", () => {
    const viewNode = (localName: string, textContent: string, role: string | null = null) => ({
      localName, textContent, isConnected: true, getAttribute: (key: string) => key === "role" ? role : null,
    });
    const unavailable = { control: "unavailable", result: "unavailable" };
    it("classifies exact source-derived matches without a closure or returning text", () => {
      const classify = runInNewContext(`(${classifyWorkoutViewNodes.toString()})`) as typeof classifyWorkoutViewNodes;
      for (const [tag, text, role, control, result] of [
        ["button", "Start swim", null, "start", "none"], ["button", "Starting…", null, "start", "none"],
        ["a", "Log swim", null, "log", "none"], ["a", "Restore from Trash", null, "removed", "none"],
        ["p", "Plan paused", "status", "plan-inactive", "none"],
        ["p", "Plan finished", "status", "plan-inactive", "none"],
        ["p", "Plan archived", "status", "plan-inactive", "none"],
        ["p", "Result removed", "status", "removed", "none"],
        ["p", "Swimming is currently unavailable.", "status", "unavailable-page", "none"],
        ["h1", "404", null, "not-found", "none"],
        ["h2", "Edit your swim", null, "none", "editing"],
        ["h2", "Your swim", null, "none", "summary"],
      ]) {
        expect(classify([viewNode(tag!, text!, role)])).toEqual({ control, result });
      }
      expect(classify([])).toEqual({ control: "none", result: "none" });
      expect(classify([viewNode("a", "Log swim"), viewNode("h2", "Edit your swim")])).toEqual({ control: "log", result: "editing" });
      expect(classify([viewNode("a", "Restore from Trash"), viewNode("h2", "Your swim")])).toEqual({ control: "removed", result: "summary" });
    });
    it("rejects conflicting, detached, unreadable, partial and lookalike matches without raw projection", () => {
      for (const nodes of [
        [viewNode("button", "Start swim"), viewNode("a", "Log swim")],
        [viewNode("button", "Start swim"), viewNode("button", "Start swim")],
        [viewNode("h2", "Your swim"), viewNode("h2", "Edit your swim")],
        [viewNode("button", "Start swim"), viewNode("h2", "Your swim")],
        [viewNode("a", "Log swim"), viewNode("h2", "Your swim")],
        [viewNode("h1", "404"), viewNode("h2", "Edit your swim")],
        [viewNode("p", "Plan paused")], [viewNode("p", "Start swim")],
        [viewNode("button", "Start swim private-payload")],
        [viewNode("h2", "Your swim private-payload")],
        [{ ...viewNode("a", "Log swim"), isConnected: false }],
        [{ ...viewNode("a", "Log swim"), get textContent(): string { throw new Error("private-payload"); } }],
        [{ ...viewNode("a", "Log swim"), get textContent() { this.isConnected = false; return "Log swim"; } }],
      ]) {
        expect(classifyWorkoutViewNodes(nodes)).toEqual(unavailable);
        expect(JSON.stringify(classifyWorkoutViewNodes(nodes))).not.toContain("private");
      }
    });
  });
});
