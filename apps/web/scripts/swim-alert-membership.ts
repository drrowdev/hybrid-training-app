// One source-derived codebook pass. Membership is diagnostic, never a copy assertion or a cause.
export const SWIM_ALERT_CODEBOOK = [
  { category: "client-save", literals: [
    // SwimHub.run
    "Could not save this change. Try again.",
  ] },
  { category: "client-start", literals: [
    // WorkoutClient.start
    "Connect to start this swim, then try again.",
  ] },
  { category: "client-storage", literals: [
    // WorkoutClient draft read/persist effects
    "Local progress is unavailable in this browser.",
    "Could not clear local progress.",
    "Could not keep your progress on this device.",
  ] },
  { category: "client-queue", literals: [
    // WorkoutClient.checkQueue; offline/flusher fallbacks persisted by outbox
    "Your swim could not be saved. Review and retry.",
    "Your pending swim was rejected. Review the entries and retry.",
    "Could not read pending saves on this device.",
    "Review your swim entries.", "permanent failure", "network",
  ] },
  { category: "client-route", literals: [
    // app/app/swim/error.tsx
    "Could not load your swims. Check your connection and try again.",
  ] },
  { category: "server-auth", literals: [
    // swim/server-context; storage.rpc + 0146_swim_request_identity.sql
    "Sign in to save your swim.", "Swimming: Not signed in.",
  ] },
  { category: "server-stale", literals: [
    // swim/server-context/actions; storage.rpc + 0146
    "Your swim plan changed. Reload and try again.",
    "This recommendation changed. Reload and review it again.",
    "These dates changed. Preview them again.",
    "Swimming: Swimming workout changed. Reload before continuing.",
    "Swimming: Swimming plan changed. Reload before continuing.",
  ] },
  { category: "server-forbidden", literals: [
    // swim/server-context/actions
    "You cannot change this swim.", "This session does not belong to the swim.",
  ] },
  { category: "server-validation", literals: [
    // swim/server-context/actions/forms/time: fixed validation messages
    "Invalid swim workout.", "Invalid swim plan.", "Check your swim entries and try again.",
    "Add a reason for the different pool.", "Choose today or a future start date.",
    "Choose the date you swam the assessment.", "A saved completion receipt is required.",
    "Only an active swim plan can skip workouts.",
    "Finish this week's swims before reviewing the next week.",
    "Enter both 200 and 400 times.", "Review this assessment again.",
    "Only a paused plan can be resumed.", "Choose today or a future resume date.",
    "The paused schedule is unavailable. Reload and try again.",
    "No swims remain. Finish this plan and set up another.",
    "The remaining swims need more days. Review the schedule.",
    "Verify both times under the same conditions.",
    "This pool cannot support exact 200 and 400 distance trials.", "Choose each swim day once.",
    "Confirm the pool used for this result.", "Enter a length count and time for each split.",
    "Split lengths exceed your total.", "Split times exceed your total.",
    "Enter time as minutes:seconds, for example 12:30.",
    "Enter a time between 0:00.001 and 1440:00.",
    // storage.rpc wraps the fixed start/status validation messages in 0146.
    "Swimming: Restore this session before opening it.",
    "Swimming: This swimming workout cannot be started.",
    "Swimming: Resume the swimming plan first.",
    "Swimming: Invalid swimming plan transition.",
  ] },
  { category: "server-fixed", literals: [
    // swim/server-context/actions/capability/safety/queries/model
    "Swim workout not found.", "Swim plan not found.", "No saved swim result was found.",
    "Could not save your swim. Try again.", "Could not check swim movements. Try again.",
    "Swimming storage returned an invalid capability response.",
    "Swimming storage is not available.", "Swimming setup is not available.",
    "Could not check your limitations. Try again before swimming.",
    "Swimming is blocked by an active limitation. Review it before starting.",
    "Could not read your swim dates.", "Could not read your swim history.",
    "The saved swim result is unavailable.", "This swim plan has an unsupported schedule.",
    "This swim workout has an unsupported schedule.",
    // storage.rpc + 0146 start/status/safety (not arbitrary database messages)
    "Swimming: Swimming workout not found.", "Swimming: Swimming plan not found.",
    "Swimming: Could not check swimming movements. Try again before starting.",
    "Swimming: Swimming is blocked by an active movement limitation.",
    "Swimming: Review your active limitations before starting this swim.",
    "Swimming: swim_start_workout returned no data.",
    "Swimming: swim_set_plan_status returned no data.",
  ] },
] as const;

export type AlertCategory = (typeof SWIM_ALERT_CODEBOOK)[number]["category"] |
  "absent" | "multiple" | "detached" | "unreadable" | "unclassified" | "unavailable";
export type AlertBackend = "reached" | "not-reached" | "unavailable";
export type AlertRevision = "unchanged" | "advanced" | "other" | "unavailable";
export type AlertPoint = "a1-pause" | "a2-post-start" | "a2-edit" | "c4-owner-1-start" | "c4-owner-2-start";
export type AlertObservation = {
  point: AlertPoint; category: AlertCategory; backend: AlertBackend; revision: AlertRevision;
};

// Passed directly to locator.evaluateAll: no module/global closure, no raw text return.
export function classifyAlertNodes(
  nodes: (Pick<Element, "isConnected" | "getRootNode" | "id"> & { readonly textContent: string | null })[],
  codebook: typeof SWIM_ALERT_CODEBOOK,
): { count: number; category: AlertCategory } {
  // -1 is a failed structural read, never an absence of genuine alerts.
  let count = -1;
  try {
    const genuine = nodes.filter((node) => {
      const root = node.getRootNode();
      return !(root instanceof ShadowRoot && root.host.localName === "next-route-announcer" &&
        root.host.parentNode === document.body && node.id === "__next-route-announcer__");
    });
    count = genuine.length;
    if (count === 0) return { count, category: "absent" };
    if (count !== 1) return { count, category: "multiple" };
    const node = genuine[0]!;
    if (!node.isConnected) return { count, category: "detached" };
    const text = node.textContent;
    if (!node.isConnected) return { count, category: "detached" };
    if (typeof text !== "string") return { count, category: "unreadable" };
    if (text.length > 256) return { count, category: "unclassified" };
    for (const entry of codebook) {
      for (const literal of entry.literals) {
        if (text === literal) return { count, category: entry.category };
      }
    }
    return { count, category: "unclassified" };
  } catch { return { count, category: "unreadable" }; }
}

export function validateAlertCategory(value: unknown): AlertCategory {
  return typeof value === "string" && (
    ["absent", "multiple", "detached", "unreadable", "unclassified", "unavailable"].includes(value) ||
    SWIM_ALERT_CODEBOOK.some((entry) => entry.category === value)
  ) ? value as AlertCategory : "unavailable";
}

export const ALERT_ANNOTATION_TYPE = "hta-swim-alert-membership-v1";
const POINTS: readonly AlertPoint[] = ["a1-pause", "a2-post-start", "a2-edit", "c4-owner-1-start", "c4-owner-2-start"];
const BACKENDS: readonly AlertBackend[] = ["reached", "not-reached", "unavailable"];
const REVISIONS: readonly AlertRevision[] = ["unchanged", "advanced", "other", "unavailable"];

export function unavailableAlert(point: AlertPoint): AlertObservation {
  return { point, category: "unavailable", backend: "unavailable", revision: "unavailable" };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validObservation(value: unknown): value is AlertObservation {
  if (!record(value) || Object.keys(value).sort().join(",") !== "backend,category,point,revision") return false;
  return POINTS.some((point) => point === value.point) &&
    validateAlertCategory(value.category) === value.category &&
    BACKENDS.some((backend) => backend === value.backend) &&
    REVISIONS.some((revision) => revision === value.revision) &&
    (value.point === "a1-pause" || value.revision === "unavailable");
}

export function alertAnnotation(value: unknown) {
  if (!validObservation(value)) return undefined;
  return {
    type: ALERT_ANNOTATION_TYPE,
    description: `point=${value.point};category=${value.category};backend=${value.backend};revision=${value.revision}`,
  };
}

// Only this reserved grammar is read. Other annotation descriptions are never accessed.
export function readAlertAnnotations(value: unknown): AlertObservation[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const observations: AlertObservation[] = [];
  for (const annotation of value) {
    if (!record(annotation) || annotation.type !== ALERT_ANNOTATION_TYPE) continue;
    if (Object.keys(annotation).sort().join(",") !== "description,type" ||
      typeof annotation.description !== "string" || annotation.description.length > 160) return undefined;
    const parts = annotation.description.split(";");
    if (parts.length !== 4) return undefined;
    const keys = ["point", "category", "backend", "revision"];
    const parsed: Record<string, unknown> = {};
    for (const [index, part] of parts.entries()) {
      const pair = part.split("=");
      if (pair.length !== 2 || pair[0] !== keys[index]) return undefined;
      parsed[keys[index]!] = pair[1];
    }
    if (!validObservation(parsed)) return undefined;
    const previous = observations.find((item) => item.point === parsed.point);
    if (previous && alertAnnotation(previous)!.description !== annotation.description) return undefined;
    if (!previous) observations.push(parsed);
  }
  return observations;
}

// Existing six-case order: original isolation C4, then A1/A2; no new case identities.
export function projectAlertObservations(caseIndex: number, observations: AlertObservation[] | undefined) {
  const points: readonly AlertPoint[] = caseIndex === 3 ? ["c4-owner-1-start", "c4-owner-2-start"] :
    caseIndex === 4 ? ["a1-pause"] : caseIndex === 5 ? ["a2-post-start", "a2-edit"] : [];
  const valid = observations?.every((item) => points.includes(item.point));
  return points.map((point) => (valid && observations?.find((item) => item.point === point)) || unavailableAlert(point));
}

export function pauseBackend(status: unknown, revision: unknown, before: unknown): Pick<AlertObservation, "backend" | "revision"> {
  if (typeof status !== "string" || !["active", "paused", "finished", "archived"].includes(status) ||
    !Number.isSafeInteger(revision) || (revision as number) < 1 ||
    !Number.isSafeInteger(before) || (before as number) < 1) {
    return { backend: "unavailable", revision: "unavailable" };
  }
  return {
    backend: status === "paused" ? "reached" : "not-reached",
    revision: revision === before ? "unchanged" : (revision as number) > (before as number) ? "advanced" : "other",
  };
}

export function startBackend(status: unknown, sessionId: unknown): AlertBackend {
  if (typeof status !== "string" || !["scheduled", "started", "completed", "skipped"].includes(status) ||
    !(sessionId === null || typeof sessionId === "string")) return "unavailable";
  return status === "started" && typeof sessionId === "string" && sessionId.length > 0 ? "reached" : "not-reached";
}
