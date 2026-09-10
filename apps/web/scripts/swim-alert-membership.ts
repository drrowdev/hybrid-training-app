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
export type C2Location = "account-page" | "login-page" | "home-page" | "deleted-home" | "other-page" | "unavailable";
export type C2HttpClass = "http-2xx" | "http-3xx" | "http-4xx" | "http-5xx";
export type C2Transport = "request-unseen" | "request-pending" | "request-failed" | C2HttpClass | "unavailable";
export type AlertControl = "start" | "log" | "plan-inactive" | "removed" |
  "unavailable-page" | "not-found" | "none" | C2Location;
export type AlertResult = "editing" | "summary" | "none" | C2Transport;
export type AlertPoint = "a1-pause" | "a2-post-start" | "a2-edit" | "c4-owner-1-start" | "c4-owner-2-start" | "c2-auth-absence" |
  "a3-finish" | "a3-finish-transport" | "a4-replay" | "a4-replay-transport" | "a7-finish" | "a7-finish-transport";
export type AlertObservation = {
  point: AlertPoint; category: AlertCategory; backend: AlertBackend; revision: AlertRevision;
  control: AlertControl; result: AlertResult;
};

// Only known, visible WorkoutClient/WorkoutPage branches (plus Next's notFound heading).
// These are sample-time matches, not hydration, action-outcome or latency evidence.
export function classifyWorkoutViewNodes(
  nodes: Pick<Element, "isConnected" | "localName" | "textContent" | "getAttribute">[],
): Pick<AlertObservation, "control" | "result"> {
  const unavailable = { control: "unavailable", result: "unavailable" } as const;
  try {
    const controls: AlertControl[] = [];
    const results: AlertResult[] = [];
    for (const node of nodes) {
      if (!node.isConnected) return unavailable;
      const text = node.textContent;
      const tag = node.localName;
      if (tag === "button" && (text === "Start swim" || text === "Starting…")) controls.push("start");
      else if (tag === "a" && text === "Log swim") controls.push("log");
      else if (tag === "a" && text === "Restore from Trash") controls.push("removed");
      else if (node.getAttribute("role") === "status" &&
        (text === "Plan paused" || text === "Plan finished" || text === "Plan archived")) controls.push("plan-inactive");
      else if (node.getAttribute("role") === "status" && text === "Result removed") controls.push("removed");
      else if (node.getAttribute("role") === "status" && text === "Swimming is currently unavailable.") controls.push("unavailable-page");
      else if (tag === "h1" && text === "404") controls.push("not-found");
      else if (tag === "h2" && text === "Edit your swim") results.push("editing");
      else if (tag === "h2" && text === "Your swim") results.push("summary");
      else return unavailable;
      if (!node.isConnected) return unavailable;
    }
    if (controls.length > 1 || results.length > 1) return unavailable;
    const control = controls[0] ?? "none";
    const result = results[0] ?? "none";
    if (result !== "none" && ["start", "plan-inactive", "unavailable-page", "not-found"].includes(control) ||
      result === "editing" && control === "removed" || result === "summary" && control === "log") return unavailable;
    return { control, result };
  } catch { return unavailable; }
}

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

export const ALERT_ANNOTATION_TYPE = "hta-swim-alert-membership-v2";
const POINTS: readonly AlertPoint[] = ["a1-pause", "a2-post-start", "a2-edit", "c4-owner-1-start", "c4-owner-2-start", "c2-auth-absence",
  "a3-finish", "a3-finish-transport", "a4-replay", "a4-replay-transport", "a7-finish", "a7-finish-transport"];
const BACKENDS: readonly AlertBackend[] = ["reached", "not-reached", "unavailable"];
const REVISIONS: readonly AlertRevision[] = ["unchanged", "advanced", "other", "unavailable"];
const CONTROLS: readonly AlertControl[] = [
  "start", "log", "plan-inactive", "removed", "unavailable-page", "not-found", "none", "unavailable",
];
const RESULTS: readonly AlertResult[] = ["editing", "summary", "none", "unavailable"];
const C2_LOCATIONS: readonly C2Location[] = ["account-page", "login-page", "home-page", "deleted-home", "other-page", "unavailable"];
const C2_HTTP_CLASSES: readonly C2HttpClass[] = ["http-2xx", "http-3xx", "http-4xx", "http-5xx"];
const C2_TRANSPORTS: readonly C2Transport[] = ["request-unseen", "request-pending", "request-failed", ...C2_HTTP_CLASSES, "unavailable"];

export function unavailableAlert(point: AlertPoint): AlertObservation {
  return { point, category: "unavailable", backend: "unavailable", revision: "unavailable",
    control: "unavailable", result: "unavailable" };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validObservation(value: unknown): value is AlertObservation {
  if (!record(value) || Object.keys(value).sort().join(",") !== "backend,category,control,point,result,revision") return false;
  return POINTS.some((point) => point === value.point) &&
    validateAlertCategory(value.category) === value.category &&
    BACKENDS.some((backend) => backend === value.backend) &&
    REVISIONS.some((revision) => revision === value.revision) &&
    (value.point === "a1-pause" || value.revision === "unavailable") &&
    (value.point === "c2-auth-absence"
      ? value.category === "unavailable" && (value.backend === "not-reached"
        ? C2_LOCATIONS.some((control) => control === value.control) && C2_TRANSPORTS.some((result) => result === value.result)
        : value.control === "unavailable" && value.result === "unavailable")
      : value.point === "a4-replay-transport" || value.point === "a3-finish-transport" || value.point === "a7-finish-transport"
        ? value.category === "unavailable" && value.backend === "unavailable" && value.control === "unavailable" &&
          C2_TRANSPORTS.some((result) => result === value.result)
        : CONTROLS.some((control) => control === value.control) && RESULTS.some((result) => result === value.result));
}

export function alertAnnotation(value: unknown) {
  if (!validObservation(value)) return undefined;
  return {
    type: ALERT_ANNOTATION_TYPE,
    description: `point=${value.point};category=${value.category};backend=${value.backend};revision=${value.revision};control=${value.control};result=${value.result}`,
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
    if (parts.length !== 6) return undefined;
    const keys = ["point", "category", "backend", "revision", "control", "result"];
    const parsed: Record<string, unknown> = {};
    for (const [index, part] of parts.entries()) {
      const pair = part.split("=");
      if (pair.length !== 2 || pair[0] !== keys[index]) return undefined;
      parsed[keys[index]!] = pair[1];
    }
    if (!validObservation(parsed)) return undefined;
    const previous = observations.find((item) => item.point === parsed.point);
    if (previous && (parsed.point === "a7-finish" || parsed.point === "a7-finish-transport")) return undefined;
    if (previous && alertAnnotation(previous)!.description !== annotation.description) return undefined;
    if (!previous) observations.push(parsed);
  }
  return observations;
}

// Declared case order: original isolation C4, A1/A2, account C2 at 9, A3/A4 at 20/21, A7 at 24.
export function projectAlertObservations(caseIndex: number, observations: AlertObservation[] | undefined) {
  const points: readonly AlertPoint[] = caseIndex === 3 ? ["c4-owner-1-start", "c4-owner-2-start"] :
    caseIndex === 4 ? ["a1-pause"] : caseIndex === 5 ? ["a2-post-start", "a2-edit"] :
      caseIndex === 9 ? ["c2-auth-absence"] : caseIndex === 20 ? ["a3-finish", "a3-finish-transport"] :
        caseIndex === 21 ? ["a4-replay", "a4-replay-transport"] :
          caseIndex === 24 ? ["a7-finish", "a7-finish-transport"] : [];
  const valid = observations?.every((item) => points.includes(item.point)) &&
    (caseIndex !== 24 || observations.length <= 2 && new Set(observations.map((item) => item.point)).size === observations.length);
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

// Receipt completion at sample time only; neither transport nor history/load proof.
export function a4ReplayBackend(
  value: unknown, error: unknown, userId: string, sessionId: string, receiptId: string,
): AlertBackend {
  try {
    if (!userId || !sessionId || !receiptId || error !== null || !record(value) || value.id !== sessionId || value.user_id !== userId ||
      !(value.completion_outbox_entry_id === null || typeof value.completion_outbox_entry_id === "string") ||
      !(value.completed_at === null ||
        typeof value.completed_at === "string" && Number.isFinite(Date.parse(value.completed_at)))) return "unavailable";
    return value.completion_outbox_entry_id === receiptId && value.completed_at !== null ? "reached" : "not-reached";
  } catch { return "unavailable"; }
}

// Auth absence at sample time only, never cascade or permanent deletion-outcome proof.
export function authAbsenceBackend(user: unknown, error: unknown, expectedId: unknown): AlertBackend {
  try {
    if (typeof expectedId !== "string" || expectedId.length === 0) return "unavailable";
    if (user === null && record(error) && error.status === 404) return "reached";
    if (error === null && record(user) && user.id === expectedId) return "not-reached";
  } catch { return "unavailable"; }
  return "unavailable";
}

export function c2Location(location: unknown, baseURL: unknown): C2Location {
  try {
    if (typeof location !== "string" || typeof baseURL !== "string") return "unavailable";
    const base = new URL(baseURL);
    const current = new URL(location);
    if (![base, current].every((url) => ["http:", "https:"].includes(url.protocol) && !url.username && !url.password) ||
      base.pathname !== "/" || base.search || base.hash) return "unavailable";
    if (current.origin !== base.origin || current.href !== location) return "other-page";
    if (current.pathname === "/app/settings/account") return "account-page";
    if (current.pathname === "/login") return "login-page";
    if (location === new URL("/?deleted=1", base).href) return "deleted-home";
    if (location === new URL("/", base).href) return "home-page";
    return "other-page";
  } catch { return "unavailable"; }
}

// Response headers only: neither body completion nor an action/deletion outcome.
export function c2HttpClass(status: unknown): C2HttpClass | "unavailable" {
  if (typeof status !== "number" || !Number.isInteger(status)) return "unavailable";
  if (status >= 200 && status < 300) return "http-2xx";
  if (status >= 300 && status < 400) return "http-3xx";
  if (status >= 400 && status < 500) return "http-4xx";
  if (status >= 500 && status < 600) return "http-5xx";
  return "unavailable";
}

export function c2Transport(matchCount: unknown, statusClass: unknown, failed: unknown, invalid: unknown): C2Transport {
  if (invalid !== false || typeof failed !== "boolean" || (matchCount !== 0 && matchCount !== 1)) return "unavailable";
  if (matchCount === 0) return statusClass === null && !failed ? "request-unseen" : "unavailable";
  if (C2_HTTP_CLASSES.some((value) => value === statusClass)) return statusClass as C2HttpClass;
  if (statusClass !== null) return "unavailable";
  return failed ? "request-failed" : "request-pending";
}
