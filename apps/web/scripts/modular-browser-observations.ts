import { z } from "zod";

const nativeRequest = z.enum(["not-observed", "pending", "http-success", "http-failure", "transport-failure", "unavailable"]);
const nativeCalendar = z.object({
  day: z.enum(["none", "one", "multiple"]),
  weekLink: z.enum(["none", "one", "multiple"]),
  dayLink: z.enum(["none", "one", "multiple"]),
}).strict();
export const nativeUiFailureSchema = z.discriminatedUnion("case", [
  z.object({
    case: z.literal("m8"),
    page: z.enum(["plan", "auth", "not-found", "error", "other", "unavailable"]),
    control: z.enum(["more", "menu", "dialog", "absent", "unavailable"]),
    request: nativeRequest,
    record: z.enum(["active", "archived", "completed", "deleted", "absent", "unavailable"]),
  }).strict(),
  z.object({
    case: z.literal("m9"),
    control: z.enum(["schedule", "schedule-absent", "unavailable"]),
    request: nativeRequest,
    record: z.enum(["retained", "absent", "unavailable"]),
    calendar: nativeCalendar.optional(),
  }).strict(),
  z.object({
    case: z.literal("m11"),
    control: z.enum(["pending", "error", "menu-open", "menu-closed", "row-absent", "schedule", "schedule-absent", "unavailable"]),
    request: nativeRequest,
    record: z.enum(["deleted", "retained", "absent", "unavailable"]),
    calendar: nativeCalendar.optional(),
  }).strict(),
  z.object({
    case: z.literal("m13"),
    control: z.enum(["pending", "error", "invalid", "editor", "library", "empty", "unavailable"]),
    request: nativeRequest,
    record: z.enum(["present", "absent", "unavailable"]),
  }).strict(),
  z.object({
    case: z.literal("m14"),
    control: z.enum(["pending", "error", "invalid", "editor", "library", "empty", "unavailable"]),
    request: nativeRequest,
    record: z.enum(["present", "absent", "unavailable"]),
  }).strict(),
]);
export type NativeUiFailure = z.infer<typeof nativeUiFailureSchema>;

export function unavailableNativeUi(caseId: NativeUiFailure["case"]): NativeUiFailure {
  if (caseId === "m8") return { case: caseId, page: "unavailable", control: "unavailable", request: "unavailable", record: "unavailable" };
  return { case: caseId, control: "unavailable", request: "unavailable", record: "unavailable" };
}

export function readNativeUiFailure(value: unknown, caseIndex: number): NativeUiFailure | undefined {
  const caseId = caseIndex === 7 ? "m8" : caseIndex === 8 ? "m9" : caseIndex === 10 ? "m11" : caseIndex === 12 ? "m13" : caseIndex === 13 ? "m14" : null;
  if (!caseId) return undefined;
  const fallback = unavailableNativeUi(caseId);
  if (!Array.isArray(value) || value.length > 128) return fallback;
  const annotations = value.filter((item) => item && typeof item === "object" &&
    !Array.isArray(item) && item.type === "native-ui-failure");
  if (annotations.length !== 1) return fallback;
  const serialized: unknown = annotations[0].description;
  if (typeof serialized !== "string" || serialized.length > 512) return fallback;
  try {
    const parsed = nativeUiFailureSchema.safeParse(JSON.parse(serialized));
    return parsed.success && parsed.data.case === caseId ? parsed.data : fallback;
  } catch { return fallback; }
}

export const MODULAR_STAGE_CODES = Object.freeze({
  m3: Object.freeze([
    "m3-01", "m3-02", "m3-03", "m3-04", "m3-05", "m3-06", "m3-07", "m3-08",
    "m3-09", "m3-10", "m3-11", "m3-12", "m3-13", "m3-14", "m3-15", "m3-16",
  ] as const),
  m4: Object.freeze([
    "m4-01", "m4-02", "m4-03", "m4-04", "m4-05", "m4-06", "m4-07", "m4-08",
    "m4-09", "m4-10", "m4-11", "m4-12", "m4-13", "m4-14", "m4-15", "m4-16",
    "m4-17", "m4-18", "m4-19", "m4-20", "m4-21", "m4-22", "m4-23", "m4-24",
  ] as const),
  m8: Object.freeze(["m8-01", "m8-02", "m8-03", "m8-04", "m8-05", "m8-06", "m8-07", "m8-08"] as const),
  m12: Object.freeze(["m12-01", "m12-02", "m12-03", "m12-04", "m12-05", "m12-06", "m12-07", "m12-08"] as const),
  m13: Object.freeze(["m13-01", "m13-02", "m13-03", "m13-04", "m13-05", "m13-06", "m13-07", "m13-08"] as const),
});
type StageCode = (typeof MODULAR_STAGE_CODES)[keyof typeof MODULAR_STAGE_CODES][number];
type SetIndices = [number, number, number, number] | "invalid" | "unavailable";
export type ModularObservation = { stage: StageCode | "unavailable"; loggedIndices: SetIndices };
export type ModularFailurePhase = "test" | "teardown" | "test-and-teardown" | "unavailable";
export type HistoryDeleteFailure = "stale" | "overlap" | "lifecycle" | "permission" | "unknown" | "unavailable";

export function classifyHistoryDeleteFailure(text: string | null): HistoryDeleteFailure {
  if (!text?.trim()) return "unavailable";
  if (text === "Your schedule changed. Review the dates again.") return "stale";
  if (text === "Review and accept the overlapping workouts before saving.") return "overlap";
  if (text === "Program lifecycle must match its plan." ||
    text === "A typed program needs exactly one matching active instance.") return "lifecycle";
  if (text === "Not signed in." || /^permission denied for (?:table|schema|function) /.test(text) ||
    text.startsWith("new row violates row-level security policy for table ")) return "permission";
  return "unknown";
}

export function readHistoryDeleteFailure(value: unknown): HistoryDeleteFailure {
  if (!Array.isArray(value) || value.length > 128) return "unavailable";
  const failures = value.filter((item) => item && typeof item === "object" &&
    !Array.isArray(item) && item.type === "history-delete-failure");
  if (failures.length !== 1) return "unavailable";
  const failure: unknown = failures[0].description;
  return failure === "stale" || failure === "overlap" || failure === "lifecycle" ||
    failure === "permission" || failure === "unknown" ? failure : "unavailable";
}

export function readModularFailurePhase(value: unknown): ModularFailurePhase {
  if (!Array.isArray(value) || value.length > 128) return "unavailable";
  const phases = value.filter((item) => item && typeof item === "object" &&
    !Array.isArray(item) && item.type === "modular-failure-phase");
  if (phases.length !== 1) return "unavailable";
  const phase: unknown = phases[0].description;
  return phase === "test" || phase === "teardown" || phase === "test-and-teardown" ? phase : "unavailable";
}

export function readModularAnnotations(value: unknown): ModularObservation {
  const unavailable: ModularObservation = { stage: "unavailable", loggedIndices: "unavailable" };
  if (!Array.isArray(value) || value.length > 128) return unavailable;
  const stages: unknown[] = [], indices: unknown[] = [];
  for (const annotation of value) {
    if (!annotation || typeof annotation !== "object" || Array.isArray(annotation)) continue;
    if (annotation.type === "modular-stage") stages.push(annotation.description);
    if (annotation.type === "modular-set-indices") indices.push(annotation.description);
  }
  const stage = stages.length === 1
    ? Object.values(MODULAR_STAGE_CODES).flat().find((code) => code === stages[0])
    : undefined;
  if (!stage) return unavailable;
  let loggedIndices: SetIndices = "unavailable";
  if (stage.startsWith("m3-") && indices.length === 1) {
    if (indices[0] === "invalid") loggedIndices = "invalid";
    else if (typeof indices[0] === "string" && indices[0].length === 9) {
      const match = /^\[([0-4]),([0-4]),([0-4]),([0-4])\]$/.exec(indices[0]);
      if (match) loggedIndices = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
    }
  }
  return { stage, loggedIndices };
}

export function projectModularObservation(caseIndex: number, value: ModularObservation): ModularObservation {
  const prefix = caseIndex === 2 ? "m3-" : caseIndex === 3 ? "m4-" : caseIndex === 7 ? "m8-"
    : caseIndex === 11 ? "m12-" : caseIndex === 12 ? "m13-" : null;
  return prefix && value.stage.startsWith(prefix)
    ? { stage: value.stage, loggedIndices: caseIndex === 2 ? value.loggedIndices : "unavailable" }
    : { stage: "unavailable", loggedIndices: "unavailable" };
}
