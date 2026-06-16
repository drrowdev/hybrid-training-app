/**
 * Quick HYROX workout — pure assembler.
 *
 * Builds an on-demand, time-boxed (~30 / ~60 min) HYROX-style conditioning
 * session from the stations the user has on hand RIGHT NOW (a per-generation
 * checklist, not their stored equipment). Mirrors the strength quick-gen split:
 * this module is pure (no DB / React) — the resolver injects the resolved
 * experience / division / stations.
 *
 * Output shape: the app `PrescriptionItem[]`, all of kind `cardio_external`
 * (movementId "" — the app's session-level cardio sentinel, exactly how the HYROX
 * program's conditioning sessions and Green Protocol cardio days are stored). The
 * session renders + logs through the generic cardio surface (one cardio block:
 * duration + RPE), no per-set logging.
 *
 * Loads are HYROX competition standards by division (`divisions.ts`); distances /
 * reps are scaled DOWN from the race for a repeatable quick circuit. No new
 * calibration coefficient — this is `[DEF]` programming content, gated by the
 * user's level + chosen time.
 */
import type { PrescriptionItem } from "@hta/db";
import { HYROX_STATIONS, getStation, stationLoadLabel } from "@hta/hyrox";
import type { HyroxExperience, HyroxDivision } from "@hta/hyrox";
import type { Equipment } from "@/lib/settings/equipment-schema";

/** The per-generation station checklist options. `run` is not a station — it
 *  enables the run legs of a compromised run / a steady run. */
export type HyroxQuickStation =
  | "run"
  | "ski_erg"
  | "rower"
  | "sled"
  | "sandbag"
  | "wall_ball"
  | "farmers"
  | "burpees";

/** The generatable session formats. */
export type HyroxQuickFormat = "circuit" | "compromised" | "erg" | "run";

export type HyroxQuickLength = "short" | "normal";

/** Checklist option → the `HYROX_STATIONS` movement keys it makes available. */
const STATION_MOVEMENTS: Record<Exclude<HyroxQuickStation, "run">, string[]> = {
  ski_erg: ["skierg"],
  rower: ["rowing-erg"],
  sled: ["sled-push", "sled-pull"],
  sandbag: ["sandbag-lunge"],
  wall_ball: ["wall-ball"],
  farmers: ["farmers-carry"],
  burpees: ["burpee-broad-jump"],
};

/** Quick-dose per station (scaled down from the race for a repeatable circuit). */
const QUICK_DOSE: Record<string, string> = {
  skierg: "250 m ski",
  "rowing-erg": "250 m row",
  "sled-push": "25 m sled push",
  "sled-pull": "25 m sled pull",
  "burpee-broad-jump": "20 m burpee broad jumps",
  "farmers-carry": "50 m farmers carry",
  "sandbag-lunge": "25 m sandbag lunges",
  "wall-ball": "25 wall balls",
};

/** Quick-dose AMOUNT only (for the structured completion view's right column). */
const QUICK_AMOUNT: Record<string, string> = {
  skierg: "250 m",
  "rowing-erg": "250 m",
  "sled-push": "25 m",
  "sled-pull": "25 m",
  "burpee-broad-jump": "20 m",
  "farmers-carry": "50 m",
  "sandbag-lunge": "25 m",
  "wall-ball": "25 reps",
};

const LENGTH_CAP_MIN: Record<HyroxQuickLength, number> = { short: 30, normal: 60 };

/** Rounds for a circuit / compromised session by length × level. `[DEF]`. */
const ROUNDS: Record<HyroxQuickLength, Record<HyroxExperience, number>> = {
  short: { beginner: 2, intermediate: 3, advanced: 3 },
  normal: { beginner: 4, intermediate: 5, advanced: 6 },
};

/** "Station" checklist options (everything except `run`). */
export const HYROX_QUICK_STATION_OPTIONS: Exclude<HyroxQuickStation, "run">[] = [
  "ski_erg",
  "rower",
  "sled",
  "sandbag",
  "wall_ball",
  "farmers",
  "burpees",
];

/** Movements (in race order) enabled by the checked stations. */
function selectedStationMovements(stations: ReadonlySet<HyroxQuickStation>): string[] {
  const enabled = new Set<string>();
  for (const opt of HYROX_QUICK_STATION_OPTIONS) {
    if (stations.has(opt)) for (const mv of STATION_MOVEMENTS[opt]) enabled.add(mv);
  }
  // Keep race order for a natural progression.
  return HYROX_STATIONS.map((s) => s.movement).filter((m) => enabled.has(m));
}

/** True when the checklist contains at least one non-run station. */
function hasStation(stations: ReadonlySet<HyroxQuickStation>): boolean {
  return HYROX_QUICK_STATION_OPTIONS.some((o) => stations.has(o));
}

function countStations(stations: ReadonlySet<HyroxQuickStation>): number {
  return HYROX_QUICK_STATION_OPTIONS.filter((o) => stations.has(o)).length;
}

/** Ergs are off-feet aerobic, not "stations" for a compromised run. */
const ERG_MOVEMENTS = new Set(["skierg", "rowing-erg"]);

/**
 * The functional stations to rotate through on a compromised run — every
 * selected station EXCEPT the ergs (the run legs already cover the aerobic
 * stimulus). Falls back to whatever's selected if only ergs are available.
 */
function compromisedStations(movements: string[]): string[] {
  const functional = movements.filter((m) => !ERG_MOVEMENTS.has(m));
  return functional.length > 0 ? functional : movements;
}

/** Which formats can be generated from the checked stations. */
export function feasibleFormats(stations: ReadonlySet<HyroxQuickStation>): HyroxQuickFormat[] {
  const out: HyroxQuickFormat[] = [];
  if (stations.has("ski_erg") || stations.has("rower")) out.push("erg");
  if (stations.has("run")) out.push("run");
  if (countStations(stations) >= 2) out.push("circuit");
  if (stations.has("run") && hasStation(stations)) out.push("compromised");
  return out;
}

/** Which checklist stations to PRE-CHECK from the user's stored equipment. Run +
 *  burpees are always on (bodyweight / nearly everyone can run or treadmill);
 *  the rest are inferred from the equipment the user owns. The user overrides per
 *  generation (e.g. a hotel gym today). */
export function defaultHyroxStationsFromEquipment(eq: Equipment): HyroxQuickStation[] {
  const out: HyroxQuickStation[] = ["run", "burpees"];
  const acc = eq.accessories;
  if (eq.cardio.includes("ski_erg")) out.push("ski_erg");
  if (eq.cardio.includes("rower")) out.push("rower");
  if (acc.sled) out.push("sled");
  if (acc.sandbag.length > 0) out.push("sandbag");
  if (acc.wallBall) out.push("wall_ball");
  if (eq.dumbbells != null || eq.kettlebells.length > 0) out.push("farmers");
  return out;
}

export interface AssembleQuickHyroxArgs {
  format: HyroxQuickFormat;
  stations: ReadonlySet<HyroxQuickStation>;
  length: HyroxQuickLength;
  experience: HyroxExperience;
  division: HyroxDivision;
}

/** A short division-load reference for the loaded stations in play. */
function loadRefs(movements: string[], division: HyroxDivision): string {
  const refs: string[] = [];
  for (const m of movements) {
    const st = getStation(m);
    if (!st) continue;
    const label = stationLoadLabel(st, division);
    if (label) refs.push(`${st.name} — ${label}`);
  }
  return refs.join("; ");
}

function cardioItem(
  kind: "cardio_z2" | "cardio_threshold",
  name: string,
  durationMin: number,
  notes: string,
): PrescriptionItem {
  return { movementId: "", kind, movementName: name, durationMin, notes };
}

/**
 * Build the quick HYROX session items for the chosen format. Returns one
 * classified cardio item (NOT `cardio_external` — that's external-program /
 * Strava-gated and can't be completed off-plan). A classified `cardio_*` kind
 * makes the session page render the in-app cardio log form, so the user logs one
 * block (duration + RPE) and finishes.
 */
export function assembleQuickHyroxItems(args: AssembleQuickHyroxArgs): PrescriptionItem[] {
  const { format, stations, length, experience, division } = args;
  const cap = LENGTH_CAP_MIN[length];

  if (format === "erg") {
    const erg = stations.has("ski_erg") ? "SkiErg" : "Rower";
    const work = cap - 5; // leave ~5 min warm-up
    return [
      cardioItem(
        "cardio_z2",
        `HYROX · ${erg} steady`,
        cap,
        `~${work} min steady on the ${erg} at Zone 2 (RPE 4–5), smooth and continuous after a short warm-up. Off-feet aerobic base for HYROX.`,
      ),
    ];
  }

  if (format === "run") {
    const work = cap - 5;
    return [
      cardioItem(
        "cardio_z2",
        "HYROX · Steady run",
        cap,
        `~${work} min easy run (Zone 2, RPE 4–5, conversational) after a short warm-up. Builds the aerobic base that's half of HYROX.`,
      ),
    ];
  }

  const rounds = ROUNDS[length][experience];
  const movements = selectedStationMovements(stations);

  if (format === "compromised") {
    const stationPool = compromisedStations(movements);
    const stationNames = stationPool
      .map((m) => getStation(m)?.name ?? m)
      .join(", ");
    const loads = loadRefs(stationPool, division);
    return [
      cardioItem(
        "cardio_threshold",
        "HYROX · Compromised Run",
        cap,
        `${rounds} × (400 m run → one race station → 400 m run) at race effort, minimal rest. ` +
          `Rotate the station each round through: ${stationNames}. ` +
          `Running on pre-fatigued legs is the signature HYROX skill.${loads ? ` ${loads}.` : ""}`,
      ),
    ];
  }

  // circuit
  const doses = movements.map((m) => QUICK_DOSE[m] ?? getStation(m)?.name ?? m).join(" → ");
  const loads = loadRefs(movements, division);
  return [
    cardioItem(
      "cardio_threshold",
      "HYROX · Station Circuit",
      cap,
      `${rounds} rounds: ${doses}. High-rep, sustainable load — build muscular endurance in the race patterns; keep transitions tight.` +
        `${loads ? ` Loads — ${loads}.` : ""}`,
    ),
  ];
}

// ── Structured completion view (renders via the same HyroxCompletionForm a
//    planned HYROX session uses) ──────────────────────────────────────────────

export interface QuickHyroxStructureRow {
  name: string;
  detail?: string;
  amount?: string;
}
export interface QuickHyroxLoadedStation {
  key: string;
  name: string;
  defaultKg: number;
  loadLabel: string;
  amount?: string;
}
export interface QuickHyroxView {
  title: string;
  divisionLabel: string;
  structure: QuickHyroxStructureRow[];
  loadedStations: QuickHyroxLoadedStation[];
}

const DIVISION_LABEL: Record<HyroxDivision, string> = {
  open: "Open division",
  pro: "Pro division",
  doubles: "Doubles",
};

/** The selected stations that carry a division load → confirm-weight rows. */
function loadedStationsView(
  movements: string[],
  division: HyroxDivision,
): QuickHyroxLoadedStation[] {
  const out: QuickHyroxLoadedStation[] = [];
  for (const m of movements) {
    const st = getStation(m);
    if (!st) continue;
    const load = division === "pro" ? st.pro : st.open;
    if (!load) continue;
    out.push({
      key: m,
      name: st.name,
      defaultKg: load.men ?? 0,
      loadLabel: stationLoadLabel(st, division),
      ...(QUICK_AMOUNT[m] ? { amount: QUICK_AMOUNT[m] } : {}),
    });
  }
  return out;
}

/**
 * Build the structured HYROX completion view for a quick session — the same
 * shape a planned HYROX session feeds to `HyroxCompletionForm`: a "what to do"
 * structure (rounds + per-station amounts) + the loaded stations to confirm. The
 * user reads it, marks complete (one time + RPE) and/or syncs Strava — no generic
 * cardio logger.
 */
export function buildQuickHyroxView(args: AssembleQuickHyroxArgs): QuickHyroxView {
  const { format, stations, length, experience, division } = args;
  const cap = LENGTH_CAP_MIN[length];
  const divisionLabel = DIVISION_LABEL[division];

  if (format === "erg") {
    const erg = stations.has("ski_erg") ? "SkiErg" : "Rower";
    return {
      title: `HYROX · ${erg}`,
      divisionLabel,
      structure: [
        { name: `${erg} steady`, detail: "Zone 2 (RPE 4–5), smooth & continuous", amount: `${cap} min` },
      ],
      loadedStations: [],
    };
  }

  if (format === "run") {
    return {
      title: "HYROX · Run",
      divisionLabel,
      structure: [
        { name: "Steady run", detail: "Zone 2 (RPE 4–5), conversational", amount: `${cap} min` },
      ],
      loadedStations: [],
    };
  }

  const rounds = ROUNDS[length][experience];
  const movements = selectedStationMovements(stations);

  if (format === "compromised") {
    const stationPool = compromisedStations(movements);
    const structure: QuickHyroxStructureRow[] = [
      { name: `${rounds} rounds`, detail: "run → station → run · race effort; rotate the station each round" },
      { name: "Run", amount: "400 m" },
      ...stationPool.map((m) => ({
        name: getStation(m)?.name ?? m,
        ...(QUICK_AMOUNT[m] ? { amount: QUICK_AMOUNT[m] } : {}),
      })),
      { name: "Run", amount: "400 m" },
    ];
    return {
      title: "HYROX · Compromised Run",
      divisionLabel,
      structure,
      loadedStations: loadedStationsView(stationPool, division),
    };
  }

  // circuit
  const structure: QuickHyroxStructureRow[] = [
    { name: `${rounds} rounds`, detail: "high-rep, sustainable load · tight transitions" },
    ...movements.map((m) => ({
      name: getStation(m)?.name ?? m,
      ...(QUICK_AMOUNT[m] ? { amount: QUICK_AMOUNT[m] } : {}),
    })),
  ];
  return {
    title: "HYROX · Station Circuit",
    divisionLabel,
    structure,
    loadedStations: loadedStationsView(movements, division),
  };
}
