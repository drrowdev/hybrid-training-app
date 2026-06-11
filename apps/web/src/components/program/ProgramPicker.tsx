"use client";

/**
 * Program picker — the sage v3 four-step wizard (Program → Loadout →
 * Benchmarks → Schedule).
 *
 * Lets a signed-in user deploy a platform program end-to-end: pick a program,
 * choose a template/loadout, confirm or edit their 1-rep maxes (which are
 * persisted to `training_maxes` on deploy), pick a weekly schedule + start
 * date, and deploy via `createProgramInstance`. Visual + content target is the
 * accepted mockup `program-wizard-v3-sage.html`.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProgramInstance, type CreateProgramInstanceResult } from "@/lib/platform/actions";
import { upsertTrainingMax } from "@/lib/training-maxes/actions";
import styles from "./ProgramPicker.module.css";

/** Stencil "code" + Oswald kicker shown on each program card (step 1). */
const CARD_META: Record<string, { kick: string; code: string }> = {
  hybrid: { kick: "Hybrid", code: "Build your own" },
  "wendler-531": { kick: "Wendler", code: "5/3/1" },
  "tactical-barbell": { kick: "Tactical Barbell", code: "TB" },
  "green-protocol": { kick: "Tactical Barbell", code: "GP" },
};

/**
 * Short, high-level card descriptor (a few words). The long description lives in
 * the info modal (PROG_INFO), not on the tile.
 */
const CARD_TAGLINE: Record<string, string> = {
  "wendler-531": "Percentage strength",
  "tactical-barbell": "Operator · Fighter · Zulu",
  "green-protocol": "Strength + endurance",
  hybrid: "Personalised strength × cardio",
};

/** Display order of the program cards (5/3/1 → TB → GP → Build-your-own). */
const CARD_ORDER = ["wendler-531", "tactical-barbell", "green-protocol", "hybrid"];

const STEP_LABELS = ["Program", "Loadout", "Benchmarks", "Schedule"] as const;

export interface PickerField {
  key: string;
  label: string;
  type: "training-max" | "number" | "select" | "multi-select" | "boolean" | "days";
  options?: { value: string; label: string }[];
  /** For `multi-select`: the maximum number of options the user may pick. */
  maxSelections?: number;
  defaultValue?: unknown;
  help?: string;
}

export interface PickerProgram {
  id: string;
  name: string;
  family: string;
  summary: string;
  /** Whether this program's deploy path is wired (5/3/1 + TB today). */
  enabled: boolean;
  /** Program prescribes its own weekly calendar — hide the weekday chooser. */
  fixedSchedule?: boolean;
  /** Goal-driven program (the engine builds the plan from the user's goals) —
   *  the setup section is framed as "build for your goals" rather than a recipe config. */
  goalDriven?: boolean;
  /** Training sessions per program-week under default setup → weekdays to pick. */
  sessionsPerWeek?: number;
  fields: PickerField[];
}

/**
 * A cluster lift entry — mirrors the engine's TbClusterEntry shape but with
 * narrowed local types (the client component cannot import engine types).
 */
export interface PickerClusterEntry {
  movement: string;
  split?: "A" | "B";
  kind?: "barbell" | "weighted-bw" | "bodyweight";
}

/**
 * Plain-data projection of a TB template for the client. The full engine
 * `TbTemplate` carries non-serialisable fields (waves, sessions, …) that the
 * picker does not need; only the cluster-shape rules cross the boundary.
 */
export interface PickerTbTemplate {
  id: string;
  name: string;
  structure: "cluster" | "split";
  clusterMin: number;
  clusterMax: number;
  allowsBodyweightFourth?: boolean;
  /** Training sessions this template runs per week → required training weekdays. */
  sessionsPerWeek: number;
  defaultCluster: PickerClusterEntry[];
}

/** TB program id (matches the engine's program family / id). */
const TB_PROGRAM_ID = "tactical-barbell";

/** A selectable movement variant for a main-lift role (resolved to a catalog id). */
export interface PickerBenchVariant {
  slug: string;
  label: string;
  movementId: string;
}

/**
 * A main-lift role for the Benchmarks step — its selectable variants plus the
 * user's currently-anchored variant/1RM (used to pre-fill the inputs and to
 * decide which lifts changed on deploy).
 */
export interface PickerBenchRole {
  /** Engine movement key (squat / bench / deadlift / press). */
  engineKey: string;
  /** App StrengthRole the key anchors on (squat / horizontal_press / …). */
  role: string;
  variants: PickerBenchVariant[];
  currentSlug?: string;
  currentOneRmKg?: number;
}

/** Rich program explainers + meta chips for the step-1 info modal (mockup PROG_INFO). */
interface ProgInfo {
  kick: string;
  title: string;
  body: string;
  meta: string[];
}
const PROG_INFO: Record<string, ProgInfo> = {
  "wendler-531": {
    kick: "Wendler 5/3/1",
    title: "5/3/1",
    body: "The most trusted \u201Cget strong slowly\u201D barbell plan. It\u2019s built on a simple idea: start lighter than you think, add a little weight every few weeks, focus on the big lifts \u2014 squat, bench, deadlift and overhead press \u2014 and aim to beat your old numbers by a rep or two rather than maxing out. You train off a conservative working weight, so sessions feel manageable and you almost never miss. Each block pushes for a few weeks, then eases off to let you recover. Patience is the whole point: it\u2019s designed to keep you progressing for years, not weeks. Best if your main goal is raw barbell strength and you want a proven, low-stress routine.",
    meta: ["4 main lifts", "Slow, steady strength"],
  },
  [TB_PROGRAM_ID]: {
    kick: "Tactical Barbell",
    title: "Tactical Barbell",
    body: "Strength training for people who also have to run, ruck, fight \u2014 or just have a life outside the gym. It was written by a tactical operator who needed to stay very strong without living under the barbell, so the sessions are short (often 20\u201330 minutes) and you lift at controlled, submaximal weights: hard work, but never grinding to failure. That leaves plenty of energy for conditioning and sport. You pick a small handful of main lifts and train them often, following a percentage plan that climbs over a 6-week block before you retest your maxes. Templates like Operator, Fighter and Zulu simply change how many days a week you lift and how many lifts you carry. Best if you want to be strong and keep doing cardio or hybrid training.",
    meta: ["Strength + conditioning", "Short 20\u201330 min sessions"],
  },
  "green-protocol": {
    kick: "Tactical Barbell \u00B7 Green Protocol",
    title: "Green Protocol",
    body: "Tactical Barbell\u2019s bigger sibling, for people who need serious endurance on top of strength \u2014 think military selection, tactical roles, or any hybrid athlete chasing an ultra-runner\u2019s engine with real barbell strength. Instead of just programming your lifts, it programs your running and rucking too: you build a wide aerobic base first, then ramp up intensity toward a goal. It runs in longer phases \u2014 Hybrid is the everyday baseline you can stay on indefinitely, while blocks like Capacity, Velocity and Outcome peak you for a specific event. The guiding idea is to build the foundation gradually: the wider the base, the higher the peak. Your lifting is prescribed here in the app; your runs and rucks are tracked through Strava. Best when endurance matters as much as strength.",
    meta: ["Strength + endurance", "Event & selection prep"],
  },
  hybrid: {
    kick: "Hybrid",
    title: "Build your own",
    body: "The do-it-all option: tell us roughly what you want \u2014 how many days a week you can train and which muscles to bias \u2014 and the app builds a balanced concurrent plan that trains strength and conditioning side by side. It runs off the same four main lifts as everything else, so your numbers and history carry straight over, and it quietly keeps strength and cardio in balance so neither crowds the other out. There\u2019s no fixed recipe to follow: the plan adapts to the days you give it. Best if you want a bit of everything \u2014 strength, muscle and an engine \u2014 without committing to a single named methodology.",
    meta: ["Strength + cardio", "Adapts to your goals"],
  },
};

/**
 * The engine appends a "(Leader \u2192 Anchor)" structural note to 5/3/1 template
 * labels. The accepted mockup shows the bare template name (the cycle structure
 * already appears in the spec strip and summary), so strip it for display.
 */
function templateDisplayLabel(label: string): string {
  return label.replace(/\s*\(Leader\s*\u2192\s*Anchor\)$/u, "");
}

// ── Step-2 loadout content (ported from the mockup LOADOUTS) ────────────────

interface ProgramLoadoutMeta {
  title: string;
  sub: string;
  /** Label for the wide spec cell: Cycle (5/3/1) / Loading (TB) / Conditioning (GP). */
  structLabel: string;
  struct: string;
  /** Fixed program length shown when the frequency is user-chosen (5/3/1). */
  lenNote?: string;
  /** Whether the user picks training frequency (5/3/1 stepper). */
  freqChoice?: boolean;
  /** Whether templates are grouped into sections (Green Protocol). */
  grouped?: boolean;
}

const PROGRAM_LOADOUT: Record<string, ProgramLoadoutMeta> = {
  "wendler-531": {
    title: "Configure your 5/3/1 block",
    sub: "Choose a template and how often you\u2019ll train. The defaults are the recommended starting point.",
    structLabel: "Cycle",
    struct: "2\u00D7 Leader \u2192 7th week \u2192 1\u00D7 Anchor",
    lenNote: "11 weeks",
    freqChoice: true,
  },
  [TB_PROGRAM_ID]: {
    title: "Configure your Tactical Barbell block",
    sub: "Pick a TB template \u2014 each one sets its own training frequency and block length. Operator is the recommended starting point.",
    structLabel: "Loading",
    struct: "Submaximal % of 1RM \u00B7 retest every 6\u201312 weeks",
  },
  "green-protocol": {
    title: "Configure your Green Protocol block",
    sub: "Green Protocol runs in two phases. Foundation builds your base from the ground up; Continuation is your flexible long-term baseline once that base is in place. New to this? Start with Capacity.",
    structLabel: "Conditioning",
    struct: "Prescribed in-app \u00B7 runs & rucks logged via Strava",
    grouped: true,
  },
};

interface TemplateCopy {
  badge?: string;
  desc: string;
  long: string;
  freq?: string;
  len?: string;
  group?: "foundation" | "continuation";
  seq?: number;
}

/** Per-template marketing copy keyed by the engine's option value. */
const TEMPLATE_COPY: Record<string, Record<string, TemplateCopy>> = {
  "wendler-531": {
    "5spro-fsl": {
      badge: "Recommended",
      desc: "Fixed 5s leader with First-Set-Last supplemental. Low fatigue, steady gains.",
      long: "5\u2019s PRO replaces the AMRAP top sets with straight sets of 5 across all three main-work weeks, keeping fatigue low so you can recover and add volume. First-Set-Last (FSL) takes the first work-set percentage and repeats it for 3\u20135 back-off sets \u2014 simple, scalable supplemental volume. Run as a Leader (build volume) \u2192 7th-week deload/test \u2192 Anchor (express strength). The most sustainable way to start 5/3/1.",
    },
    "bbb-leader": {
      desc: "5\u00D710 supplemental at 50\u201360%. High-volume hypertrophy on the main work.",
      long: "After your main 5/3/1 work, do 5 sets of 10 reps of the same lift at 50\u201360% of your Training Max. It\u2019s brutally simple and one of the most effective mass-builders in the program \u2014 the high rep volume drives hypertrophy while the main work keeps strength progressing. Best run when recovery and calories are good.",
    },
  },
  [TB_PROGRAM_ID]: {
    operator: {
      badge: "Recommended",
      desc: "3 lifts, trained 3\u00D7/week. The flagship low-frequency strength template.",
      freq: "3 sessions / week",
      len: "6-week block",
      long: "Operator is Tactical Barbell\u2019s signature template: pick up to 3 main lifts (a \u2018cluster\u2019) and train all of them, 3 times a week, every other day. Loads are a submaximal percentage of your 1RM that waves up over a 6-week block. Because it\u2019s low-frequency and never taken to failure, it leaves plenty in the tank for heavy conditioning \u2014 which is the whole point of TB.",
    },
    fighter: {
      desc: "2\u00D7/week strength built to sit under heavy conditioning.",
      freq: "2 sessions / week",
      len: "6-week block",
      long: "Fighter is the 2-day-a-week minimum-effective-dose strength template. Same submaximal percentage waves as Operator, but only twice a week \u2014 freeing up the calendar for high volumes of running, rucking or sport practice. The go-to when conditioning is your priority and strength just needs to be maintained or slowly built.",
    },
    zulu: {
      desc: "A/B split, 4 lifts trained twice each across the week.",
      freq: "4 sessions / week",
      len: "6-week block",
      long: "Zulu splits 4 main lifts into two pairs (A and B) and trains each pair twice across 4 sessions a week. It lets you carry more lifts than Operator\u2019s 3-lift cap while staying submaximal. A good fit when you want broader barbell coverage and can give strength 4 days.",
    },
    "zulu-ia": {
      desc: "Zulu, autoregulated: 3\u20135 sets, heavier weeks 4\u20136.",
      freq: "4 sessions / week",
      len: "6-week block",
      long: "The Individualised/Advanced Zulu variant. Same A/B split, but you autoregulate 3\u20135 sets per lift and the back half of the block runs heavier, peaking at 1\u20132 reps. For intermediate-to-advanced lifters who want more intensity than standard Zulu.",
    },
    gladiator: {
      desc: "Higher-volume 5\u00D75 for when conditioning load is low.",
      freq: "3 sessions / week",
      len: "6-week block",
      long: "Gladiator runs higher-volume 5\u00D75 main work, 3 days a week. More hypertrophy and work capacity than Operator, but it costs more recovery \u2014 best used in phases when your conditioning load is light.",
    },
    mass: {
      desc: "Hypertrophy-leaning 4\u00D76\u21924\u00D73 wave.",
      freq: "3 sessions / week",
      len: "6-week block",
      long: "Mass biases the template toward size: higher-rep 4\u00D76 work that waves down to 4\u00D73 over the block, 3 days a week, with short rest. Use it for a dedicated muscle-building phase while keeping conditioning minimal.",
    },
    "grey-man": {
      desc: "A generalist double-wave block.",
      freq: "3 sessions / week",
      len: "12-week block",
      long: "Grey Man is a 12-week generalist block that double-waves volume and then intensity \u2014 a longer, balanced run for steady all-round progress when you don\u2019t want to commit to a single specific goal.",
    },
  },
  "green-protocol": {
    capacity: {
      group: "foundation",
      seq: 1,
      badge: "Start here",
      desc: "Strength + an easy aerobic base. The starting block \u2014 ends in a 6-mile / 60-min run.",
      freq: "6 sessions / week",
      len: "12-week block",
      long: "Capacity is where everyone starts. It\u2019s a concentrated block of building muscle, strength and a basic aerobic base, lifting paired with easy steady-state running over about 12 weeks. Clear its 6-mile / 60-minute benchmark and you\u2019re ready for Velocity.",
    },
    velocity: {
      group: "foundation",
      seq: 2,
      desc: "Picks up where Capacity ends \u2014 builds your run engine to a 20-mile off-road benchmark.",
      freq: "6 sessions / week",
      len: "17-week block",
      long: "Velocity turns the aerobic base from Capacity into real endurance: easy mileage, speedwork, hills and an escalating long run, with lifting dialled back to support it. Benchmark: a 20-mile off-road run. Do this after Capacity.",
    },
    outcome: {
      group: "foundation",
      seq: 3,
      desc: "Ruck-focused peaking \u2014 channels it all into a 20-mile / 50 lb ruck.",
      freq: "6 sessions / week",
      len: "17-week block",
      long: "Outcome channels your strength and conditioning into rucking, work capacity and muscular endurance, finishing with a challenging peaking phase. Benchmark: a 20-mile / 50 lb ruck. Skippable if your role isn\u2019t ruck-heavy.",
    },
    hybrid: {
      group: "continuation",
      badge: "Baseline",
      desc: "Lifting + running in two phases. The simple everyday baseline.",
      freq: "5\u20136 sessions / week",
      len: "14-week cycle",
      long: "Hybrid is the everyday Continuation baseline: lifting and running in a simple two-phase approach \u2014 the first half emphasises strength, the second prioritises conditioning. Simple, flexible and sustainable \u2014 you can run it indefinitely.",
    },
    "hybrid-op": {
      group: "continuation",
      desc: "A 50/50 strength-and-conditioning variant of Hybrid.",
      freq: "6 sessions / week",
      len: "6-week cycle",
      long: "Hybrid/Op is a 50/50 variant of standard Hybrid \u2014 strength and conditioning weighted evenly rather than split into two phases. A fit for roles with a lighter endurance demand that still want both qualities trained continuously.",
    },
    ccat: {
      group: "continuation",
      desc: "Concurrent \u2014 trains every domain every week.",
      freq: "6 sessions / week",
      len: "10-week cycle",
      long: "C/CAT (Concurrent / Combat-Arms Template) trains all the major domains every week: a strength component, rucking, speedwork, elevation work and long runs. It keeps your fingers in every pie at a sustainable tempo.",
    },
    icat: {
      group: "continuation",
      desc: "Intermittent concurrent \u2014 a lighter-touch C/CAT.",
      freq: "5 sessions / week",
      len: "10-week cycle",
      long: "I/CAT is the intermittent variant of C/CAT: the same all-domain concurrent approach at a slightly reduced weekly volume, for when life or recovery calls for a lighter touch.",
    },
  },
};

const GP_GROUPS: Record<"foundation" | "continuation", { name: string; tag: string; blurb: string }> = {
  foundation: {
    name: "Foundation",
    tag: "Build your base",
    blurb: "The entry path \u2014 work through these in order. Each ends in a benchmark that unlocks the next. Start here if you\u2019re building your engine from the ground up.",
  },
  continuation: {
    name: "Continuation",
    tag: "Long-term baseline",
    blurb: "For once your base is in place. Flexible, sustainable everyday programming you can run indefinitely and customise around life.",
  },
};

/** Program → human label used in the summary table + info modal kicker. */
const PROGRAM_LABEL: Record<string, string> = {
  "wendler-531": "Wendler 5/3/1",
  [TB_PROGRAM_ID]: "Tactical Barbell",
  "green-protocol": "Green Protocol",
  hybrid: "Hybrid",
};

/** The setup field the loadout step writes into (templateId or GP phaseId). */
function loadoutFieldKey(programId: string): "templateId" | "phaseId" | null {
  if (programId === "green-protocol") return "phaseId";
  if (programId === "wendler-531" || programId === TB_PROGRAM_ID) return "templateId";
  return null;
}

const MOVEMENT_LABEL: Record<string, string> = {
  squat: "Squat",
  bench: "Bench Press",
  deadlift: "Deadlift",
  press: "Overhead Press",
  pullup: "Pull-ups",
};

function movementLabel(key: string): string {
  return MOVEMENT_LABEL[key] ?? key;
}

// ── Units + 1RM estimate helpers ────────────────────────────────────────────
const KG_PER_LB = 0.45359237;
type Unit = "kg" | "lb";
function kgToDisplay(kg: number, unit: Unit): number {
  return unit === "lb" ? Math.round(kg / KG_PER_LB) : Math.round(kg * 2) / 2;
}
function displayToKg(value: number, unit: Unit): number {
  return unit === "lb" ? value * KG_PER_LB : value;
}
/** Epley estimated 1RM: weight × (1 + reps/30). */
function epley1rm(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return weight * (1 + reps / 30);
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayType = "strength" | "cardio" | "rest";

/** Build a default week: `n` strength days on the canonical spread, rest elsewhere. */
function buildWeek(n: number): DayType[] {
  const clamped = Math.max(1, Math.min(7, n));
  const spread = DAY_SPREADS[clamped] ?? DAY_SPREADS[4]!;
  const w: DayType[] = Array.from({ length: 7 }, () => "rest");
  for (const d of spread) w[d] = "strength";
  return w;
}

/** Sensible default weekday spread for a given sessions-per-week count (0=Mon). */
const DAY_SPREADS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/** Clone the template's defaultCluster, dropping unknown movement keys. */
export function defaultClusterFor(
  template: PickerTbTemplate,
  anchoredKeys: string[],
): PickerClusterEntry[] {
  const allowed = new Set(anchoredKeys);
  return template.defaultCluster
    .filter((c) => allowed.has(c.movement) || c.kind === "bodyweight")
    .map((c) => ({
      movement: c.movement,
      ...(c.split ? { split: c.split } : {}),
      ...(c.kind ? { kind: c.kind } : {}),
    }));
}

export interface ClusterValidationLite {
  ok: boolean;
  errors: string[];
  countingLifts: number;
}

/**
 * Replica of the engine's `validateCluster` that runs against the plain-data
 * `PickerTbTemplate`. Kept in sync with packages/tacticalbarbell/src/validate.ts.
 */
export function validateClusterClient(
  template: PickerTbTemplate,
  cluster: PickerClusterEntry[],
): ClusterValidationLite {
  const errors: string[] = [];
  const bw = cluster.filter((l) => l.kind === "bodyweight").length;
  const counting = template.allowsBodyweightFourth
    ? cluster.length - Math.min(bw, 1)
    : cluster.length;

  if (template.clusterMin === template.clusterMax) {
    if (counting !== template.clusterMin) {
      errors.push(
        `${template.name} uses exactly ${template.clusterMin} main lift${template.clusterMin === 1 ? "" : "s"}.`,
      );
    }
  } else {
    if (counting < template.clusterMin) {
      errors.push(`${template.name} needs at least ${template.clusterMin} main lifts.`);
    }
    if (counting > template.clusterMax) {
      errors.push(
        `${template.name} allows at most ${template.clusterMax} main lifts` +
          (template.allowsBodyweightFourth ? " (plus one optional bodyweight movement)." : "."),
      );
    }
  }

  if (template.allowsBodyweightFourth && bw > 1) {
    errors.push(`${template.name} allows only one optional bodyweight movement.`);
  }

  if (template.structure === "split") {
    const a = cluster.filter((l) => l.split === "A").length;
    const b = cluster.filter((l) => l.split === "B").length;
    const ungrouped = cluster.filter((l) => l.split !== "A" && l.split !== "B").length;
    if (ungrouped > 0) {
      errors.push(`${template.name} assigns every lift to an A or B session.`);
    }
    if (a === 0 || b === 0) {
      errors.push(
        `${template.name} divides lifts across an A and a B session — each needs at least one lift.`,
      );
    }
    if (cluster.length < 4) {
      errors.push(`${template.name} needs at least 4 lifts split across A and B.`);
    }
  }

  const seen = new Set<string>();
  for (const lift of cluster) {
    if (seen.has(lift.movement)) {
      errors.push(`Duplicate lift in the cluster: ${lift.movement}.`);
    }
    seen.add(lift.movement);
  }

  return { ok: errors.length === 0, errors, countingLifts: counting };
}

function defaultValuesFor(fields: PickerField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "boolean") out[f.key] = f.defaultValue ?? false;
    else if (f.type === "number") out[f.key] = f.defaultValue ?? 0;
    else if (f.type === "select") out[f.key] = f.defaultValue ?? f.options?.[0]?.value ?? "";
    else if (f.type === "multi-select") out[f.key] = f.defaultValue ?? [];
    else out[f.key] = f.defaultValue ?? "";
  }
  return out;
}

/**
 * Pure selection toggle for a `multi-select` field. Adds `value` if absent
 * (unless `max` is already reached), removes it if present. Order-preserving.
 * Exported for unit testing.
 */
export function toggleMultiSelect(
  current: readonly string[],
  value: string,
  max?: number,
): string[] {
  if (current.includes(value)) return current.filter((v) => v !== value);
  if (max != null && current.length >= max) return [...current];
  return [...current, value];
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ProgramPicker({
  programs,
  anchoredKeys,
  tbTemplates = [],
  benchRoles = [],
}: {
  programs: PickerProgram[];
  anchoredKeys: string[];
  tbTemplates?: PickerTbTemplate[];
  benchRoles?: PickerBenchRole[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateProgramInstanceResult | null>(null);
  const [modalInfo, setModalInfo] = useState<ProgInfo | null>(null);

  // Wizard step (0 Program · 1 Loadout · 2 Benchmarks · 3 Schedule).
  const [step, setStep] = useState<number>(0);

  // No pre-selection: the user must pick a program on step 1 before continuing.
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = programs.find((p) => p.id === selectedId) ?? null;

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [startedOn, setStartedOn] = useState<string>(todayYmd());

  // Weekly schedule grid: 7 day cells. The strength days become deploy `weekdays`.
  const [week, setWeek] = useState<DayType[]>(() => buildWeek(4));
  // 5/3/1 lets the user pick strength frequency; other programs derive it.
  const [freq531, setFreq531] = useState<number>(4);
  const [unit, setUnit] = useState<Unit>("kg");

  // Per-lift 1RM entry: a display-unit string + chosen variant slug, keyed by engine key.
  const [benchVals, setBenchVals] = useState<Record<string, { slug: string; valueStr: string }>>({});
  const [benchTouched, setBenchTouched] = useState<Set<string>>(new Set());
  const [estimate, setEstimate] = useState<{ key: string; weight: string; reps: string } | null>(null);

  const benchRoleByKey = useMemo(() => {
    const m = new Map<string, PickerBenchRole>();
    for (const r of benchRoles) m.set(r.engineKey, r);
    return m;
  }, [benchRoles]);

  const isTb = selected?.id === TB_PROGRAM_ID;
  const tbTemplateById = useMemo(() => {
    const m = new Map<string, PickerTbTemplate>();
    for (const t of tbTemplates) m.set(t.id, t);
    return m;
  }, [tbTemplates]);

  const tbTemplateId = isTb ? String(values.templateId ?? "") : "";
  const activeTbTemplate = isTb ? tbTemplateById.get(tbTemplateId) ?? null : null;

  const [cluster, setCluster] = useState<PickerClusterEntry[]>(() =>
    activeTbTemplate ? defaultClusterFor(activeTbTemplate, anchoredKeys) : [],
  );
  // Reset the cluster + week to the template default whenever the selected
  // template changes — React's "store-prev-prop-and-adjust-during-render" pattern.
  const [lastTbTemplateId, setLastTbTemplateId] = useState<string | null>(
    activeTbTemplate?.id ?? null,
  );
  const currentTbId = activeTbTemplate?.id ?? null;
  if (currentTbId !== lastTbTemplateId) {
    setLastTbTemplateId(currentTbId);
    setCluster(activeTbTemplate ? defaultClusterFor(activeTbTemplate, anchoredKeys) : []);
    if (activeTbTemplate) setWeek(buildWeek(activeTbTemplate.sessionsPerWeek));
  }

  const fixedSchedule = !!selected?.fixedSchedule;

  // The program dictates how many strength days a week it needs. TB's active
  // TEMPLATE owns the frequency; 5/3/1 lets the user choose it; fixed-schedule
  // programs (Green Protocol) prescribe their own calendar; Hybrid is open.
  const requiredDays: number | null = fixedSchedule
    ? null
    : isTb
      ? activeTbTemplate?.sessionsPerWeek ?? null
      : selected?.id === "wendler-531"
        ? freq531
        : selected?.sessionsPerWeek ?? null;

  const weekdays = useMemo(
    () => week.flatMap((t, i) => (t === "strength" ? [i] : [])),
    [week],
  );
  const dayCounts = useMemo(() => {
    const c = { strength: 0, cardio: 0, rest: 0 };
    for (const t of week) c[t] += 1;
    return c;
  }, [week]);
  const daysMatch = fixedSchedule || requiredDays == null || weekdays.length === requiredDays;

  const clusterValidation = useMemo<ClusterValidationLite | null>(() => {
    if (!activeTbTemplate) return null;
    return validateClusterClient(activeTbTemplate, cluster);
  }, [activeTbTemplate, cluster]);
  const clusterOk = !activeTbTemplate || (clusterValidation?.ok ?? false);

  // Which main-lift roles the Benchmarks step shows. Cluster programs (TB) show
  // the barbell lifts in their chosen cluster; everyone else shows all four mains.
  const relevantBenchKeys = useMemo<string[]>(() => {
    if (activeTbTemplate) {
      return cluster
        .filter((c) => c.kind !== "bodyweight" && benchRoleByKey.has(c.movement))
        .map((c) => c.movement);
    }
    return benchRoles.map((r) => r.engineKey);
  }, [activeTbTemplate, cluster, benchRoles, benchRoleByKey]);

  const enteredAnyTm = useMemo(
    () => Object.values(benchVals).some((b) => Number(b.valueStr) > 0),
    [benchVals],
  );
  const hasUsableTms = anchoredKeys.length > 0 || enteredAnyTm;

  const canDeploy =
    !!selected?.enabled &&
    (fixedSchedule || weekdays.length > 0) &&
    daysMatch &&
    hasUsableTms &&
    clusterOk &&
    !pending;

  // Loadout step derivations (the setup field the template/phase choice writes to).
  const loadoutKey = selected ? loadoutFieldKey(selected.id) : null;
  const loadoutField = loadoutKey ? selected?.fields.find((f) => f.key === loadoutKey) : undefined;
  const loadoutOptions = loadoutField?.options ?? [];
  const selectedLoadoutValue = loadoutKey ? String(values[loadoutKey] ?? "") : "";
  const loadoutMeta = selected ? PROGRAM_LOADOUT[selected.id] : undefined;

  function initBenchVals(u: Unit): Record<string, { slug: string; valueStr: string }> {
    const out: Record<string, { slug: string; valueStr: string }> = {};
    for (const r of benchRoles) {
      const slug = r.currentSlug ?? r.variants[0]?.slug ?? "";
      const valueStr = r.currentOneRmKg != null ? String(kgToDisplay(r.currentOneRmKg, u)) : "";
      out[r.engineKey] = { slug, valueStr };
    }
    return out;
  }

  function selectProgram(p: PickerProgram) {
    if (!p.enabled) return;
    setSelectedId(p.id);
    const defaults = defaultValuesFor(p.fields);
    setValues(defaults);
    setResult(null);
    setEstimate(null);
    setBenchVals(initBenchVals(unit));
    setBenchTouched(new Set());

    if (p.id === TB_PROGRAM_ID) {
      const t = tbTemplateById.get(String(defaults.templateId ?? ""));
      setCluster(t ? defaultClusterFor(t, anchoredKeys) : []);
      setLastTbTemplateId(String(defaults.templateId ?? "") || null);
      setWeek(buildWeek(t?.sessionsPerWeek ?? p.sessionsPerWeek ?? 3));
    } else {
      setCluster([]);
      setLastTbTemplateId(null);
      setWeek(buildWeek(p.sessionsPerWeek ?? 4));
    }
    setFreq531(p.id === "wendler-531" ? (p.sessionsPerWeek ?? 4) : 4);
  }

  function setField(key: string, raw: unknown) {
    setValues((prev) => ({ ...prev, [key]: raw }));
  }

  function setBenchValue(key: string, valueStr: string) {
    setBenchVals((prev) => ({ ...prev, [key]: { slug: prev[key]?.slug ?? "", valueStr } }));
    setBenchTouched((prev) => new Set(prev).add(key));
  }
  function setBenchVariant(key: string, slug: string) {
    setBenchVals((prev) => ({ ...prev, [key]: { slug, valueStr: prev[key]?.valueStr ?? "" } }));
    setBenchTouched((prev) => new Set(prev).add(key));
  }
  function toggleUnit(next: Unit) {
    if (next === unit) return;
    setBenchVals((prev) => {
      const out: Record<string, { slug: string; valueStr: string }> = {};
      for (const [k, v] of Object.entries(prev)) {
        const n = Number(v.valueStr);
        if (v.valueStr === "" || !Number.isFinite(n)) {
          out[k] = v;
          continue;
        }
        const kg = displayToKg(n, unit);
        out[k] = { slug: v.slug, valueStr: String(kgToDisplay(kg, next)) };
      }
      return out;
    });
    setUnit(next);
  }

  function cycleDay(i: number) {
    setWeek((prev) => {
      const cur = prev[i];
      const next: DayType = cur === "strength" ? "cardio" : cur === "cardio" ? "rest" : "strength";
      const w = [...prev];
      w[i] = next;
      return w;
    });
  }
  function resetWeek() {
    setWeek(buildWeek(requiredDays ?? freq531));
  }
  function bumpFreq(delta: number) {
    if (selected?.id !== "wendler-531") return;
    const floor = selected.sessionsPerWeek ?? 4;
    const next = Math.max(floor, Math.min(7, freq531 + delta));
    setFreq531(next);
    setWeek(buildWeek(next));
  }

  function applyEstimate() {
    if (!estimate) return;
    const w = Number(estimate.weight);
    const r = Number(estimate.reps);
    const est = epley1rm(w, r);
    if (est > 0) {
      const display = unit === "lb" ? Math.round(est) : Math.round(est * 2) / 2;
      setBenchValue(estimate.key, String(display));
    }
    setEstimate(null);
  }

  function deploy() {
    if (!selected) return;
    setResult(null);
    const setupValues: Record<string, unknown> = { ...values };
    if (activeTbTemplate) {
      if (activeTbTemplate.structure === "split") {
        setupValues.splitA = cluster
          .filter((c) => c.split === "A")
          .map((c) => ({ movement: c.movement, ...(c.kind ? { kind: c.kind } : {}) }));
        setupValues.splitB = cluster
          .filter((c) => c.split === "B")
          .map((c) => ({ movement: c.movement, ...(c.kind ? { kind: c.kind } : {}) }));
      } else {
        setupValues.cluster = cluster.map((c) => ({
          movement: c.movement,
          ...(c.kind ? { kind: c.kind } : {}),
        }));
      }
    }

    // Lifts the user set or changed → persist as entered 1RMs before deploy. We
    // only write touched rows so an untouched, pre-filled value is never re-saved
    // (this keeps programs that render off real TMs from gaining a tm_percent).
    const saves: { movementId: string; oneRmKg: number; label: string }[] = [];
    for (const key of relevantBenchKeys) {
      if (!benchTouched.has(key)) continue;
      const role = benchRoleByKey.get(key);
      const bv = benchVals[key];
      if (!role || !bv) continue;
      const n = Number(bv.valueStr);
      if (!Number.isFinite(n) || n <= 0) continue;
      const variant = role.variants.find((v) => v.slug === bv.slug);
      if (!variant) continue;
      const kg = Math.round(displayToKg(n, unit) * 2) / 2;
      saves.push({ movementId: variant.movementId, oneRmKg: kg, label: movementLabel(key) });
    }

    startTransition(async () => {
      for (const s of saves) {
        const fd = new FormData();
        fd.set("movementId", s.movementId);
        fd.set("oneRmKg", String(s.oneRmKg));
        const tmRes = await upsertTrainingMax(fd);
        if (!tmRes.ok) {
          setResult({ ok: false, error: `Couldn\u2019t save your ${s.label} 1-rep max: ${tmRes.error}` });
          return;
        }
      }
      const res = await createProgramInstance({
        programId: selected.id,
        setupValues,
        weekdays,
        startedOn,
      });
      setResult(res);
      if (res.ok) router.push("/app");
    });
  }

  function openProgramInfo(p: PickerProgram) {
    const info = PROG_INFO[p.id];
    setModalInfo(
      info ?? {
        kick: CARD_META[p.id]?.kick ?? p.family,
        title: p.name,
        body: p.summary,
        meta: [],
      },
    );
  }

  const canContinue = step !== 0 || !!selected;

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }
  function goNext() {
    setStep((s) => Math.min(3, s + 1));
  }

  // ── Step renderers ─────────────────────────────────────────────────────────
  function renderProgramStep() {
    return (
      <div className={styles.step}>
        <h2 className={styles.h1}>Choose your program</h2>
        <p className={styles.sub}>
          {"Pick the methodology you\u2019ll run. Your strength numbers, history and stats stay with you if you switch later."}
        </p>
        <div className={styles.grid}>
          {[...programs]
            .sort((a, b) => {
              const ai = CARD_ORDER.indexOf(a.id);
              const bi = CARD_ORDER.indexOf(b.id);
              return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            })
            .map((p) => {
            const meta = CARD_META[p.id] ?? { kick: "", code: p.name };
            const wrap = meta.code.includes(" ");
            const codeCls = `${styles.code}${wrap ? ` ${styles.codeWrap}` : ""}`;
            const codeStyle = !wrap && meta.code.length > 4 ? { fontSize: 20 } : undefined;
            const tagline = CARD_TAGLINE[p.id] ?? p.summary;
            const isSel = p.id === selectedId;
            return (
              <div key={p.id} style={{ position: "relative", display: "flex" }}>
                <button
                  type="button"
                  data-testid={`program-card-${p.id}`}
                  onClick={() => selectProgram(p)}
                  className={`${styles.pcard}${isSel ? ` ${styles.sel}` : ""}`}
                >
                  <Ticks />
                  <div className={styles.kick}>{meta.kick}</div>
                  <div className={codeCls} style={codeStyle}>
                    {meta.code}
                  </div>
                  <div className={styles.pdesc}>{tagline}</div>
                </button>
                <button
                  type="button"
                  aria-label={`About ${p.name}`}
                  title={`About ${p.name}`}
                  className={styles.pinfo}
                  onClick={(e) => {
                    e.stopPropagation();
                    openProgramInfo(p);
                  }}
                >
                  i
                </button>
              </div>
            );
          })}
          {/* Coming-soon teaser — not yet wired to an engine. */}
          <div className={`${styles.pcard} ${styles.locked}`} aria-disabled="true">
            <Ticks />
            <div className={styles.kick}>{"\u00A0"}</div>
            <div className={styles.code} style={{ fontSize: 24 }}>
              HYROX
            </div>
            <div className={styles.pdesc}>Coming soon</div>
          </div>
        </div>
      </div>
    );
  }

  function renderLoadoutOptions() {
    if (!selected || !loadoutKey) return null;
    const copy = TEMPLATE_COPY[selected.id] ?? {};
    if (loadoutMeta?.grouped) {
      // Green Protocol — grouped into Foundation / Continuation sections.
      let lastGroup: string | null = null;
      return (
        <div className={`${styles.opts} ${styles.optsGrouped}`}>
          {loadoutOptions.map((o) => {
            const c = copy[o.value];
            const group = c?.group ?? "continuation";
            const header =
              group !== lastGroup ? ((lastGroup = group), GP_GROUPS[group]) : null;
            const on = o.value === selectedLoadoutValue;
            const dispLabel = templateDisplayLabel(o.label);
            return (
              <div key={o.value} style={{ display: "contents" }}>
                {header && (
                  <div className={styles.optsec}>
                    <div className={styles.sh}>
                      {header.name}
                      <span className={styles.shTag}>{header.tag}</span>
                    </div>
                    <div className={styles.sx}>{header.blurb}</div>
                  </div>
                )}
                <button
                  type="button"
                  data-testid={`loadout-opt-${o.value}`}
                  onClick={() => setField(loadoutKey, o.value)}
                  className={`${styles.opt}${on ? ` ${styles.optSel}` : ""}`}
                >
                  <div className={styles.optOn}>
                    <span className={styles.optNm}>
                      {c?.seq ? <span className={styles.seq}>{c.seq}</span> : null}
                      {dispLabel}
                    </span>
                    {c?.badge ? (
                      <span className={`${styles.pill}${c.badge === "Start here" ? ` ${styles.pillStart}` : ""}`}>
                        {c.badge}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.optDesc}>
                    {c?.desc ?? dispLabel}
                    {c?.long ? (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`More about ${dispLabel}`}
                        className={styles.optInfo}
                        onClick={(e) => {
                          e.stopPropagation();
                          setModalInfo({
                            kick: PROG_INFO[selected.id]?.kick ?? selected.family,
                            title: dispLabel,
                            body: c.long,
                            meta: [c.freq, c.len].filter((x): x is string => !!x),
                          });
                        }}
                      >
                        i
                      </span>
                    ) : null}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      );
    }
    // 5/3/1 + TB — two-column option cards.
    return (
      <div className={styles.opts}>
        {loadoutOptions.map((o, i) => {
          const c = copy[o.value];
          const on = o.value === selectedLoadoutValue;
          const badge = c?.badge ?? (i === 0 ? "Recommended" : undefined);
          const dispLabel = templateDisplayLabel(o.label);
          return (
            <button
              key={o.value}
              type="button"
              data-testid={`loadout-opt-${o.value}`}
              onClick={() => setField(loadoutKey, o.value)}
              className={`${styles.opt}${on ? ` ${styles.optSel}` : ""}`}
            >
              <div className={styles.optOn}>
                <span className={styles.optNm}>{dispLabel}</span>
                {badge ? <span className={styles.pill}>{badge}</span> : null}
              </div>
              <div className={styles.optDesc}>
                {c?.desc ?? dispLabel}
                {c?.long ? (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`More about ${dispLabel}`}
                    className={styles.optInfo}
                    onClick={(e) => {
                      e.stopPropagation();
                      setModalInfo({
                        kick: PROG_INFO[selected.id]?.kick ?? selected.family,
                        title: dispLabel,
                        body: c.long,
                        meta: [c.freq, c.len].filter((x): x is string => !!x),
                      });
                    }}
                  >
                    i
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  function renderSpecStrip() {
    if (!selected || !loadoutMeta) return null;
    const copy = TEMPLATE_COPY[selected.id]?.[selectedLoadoutValue];
    const freqText = copy?.freq
      ? copy.freq.toUpperCase()
      : requiredDays != null
        ? `${requiredDays} / WEEK`
        : "\u2014";
    const lenText = loadoutMeta.freqChoice
      ? (loadoutMeta.lenNote ?? "\u2014").toUpperCase()
      : (copy?.len ?? "\u2014").toUpperCase();
    return (
      <div className={styles.specwrap}>
        <div className={styles.label}>Your block</div>
        <div className={styles.spec}>
          <div className={styles.cell}>
            <div className={styles.cl}>Frequency</div>
            <div className={styles.cv}>
              {loadoutMeta.freqChoice ? (
                <span className={styles.ministep}>
                  <button type="button" onClick={() => bumpFreq(-1)} aria-label="Fewer days">
                    {"\u2013"}
                  </button>
                  <span className={styles.ministepV}>{freq531}</span>
                  <button type="button" onClick={() => bumpFreq(1)} aria-label="More days">
                    +
                  </button>
                  <span className={styles.daysHint}>days / week</span>
                </span>
              ) : (
                freqText
              )}
            </div>
          </div>
          <div className={styles.cell}>
            <div className={styles.cl}>Length</div>
            <div className={styles.cv}>{lenText}</div>
          </div>
          <div className={`${styles.cell} ${styles.wide}`}>
            <div className={styles.cl}>{loadoutMeta.structLabel}</div>
            <div className={`${styles.cv} ${styles.cvSm}`}>{loadoutMeta.struct}</div>
          </div>
        </div>
      </div>
    );
  }

  function renderGpPlan() {
    if (!selected || selected.id !== "green-protocol") return null;
    const plan = GP_FOUNDATION.includes(selectedLoadoutValue)
      ? GP_FOUNDATION.slice(GP_FOUNDATION.indexOf(selectedLoadoutValue))
      : [selectedLoadoutValue];
    const labelFor = (v: string) =>
      loadoutOptions.find((o) => o.value === v)?.label ?? v;
    const copy = TEMPLATE_COPY["green-protocol"] ?? {};
    return (
      <div className={styles.planwrap}>
        <div className={styles.planhead}>
          <div className={styles.label} style={{ margin: 0 }}>
            Your Green Protocol
          </div>
        </div>
        <p className={styles.plannote}>
          {"Foundation blocks run back-to-back, each unlocked by hitting its benchmark. You\u2019ll fine-tune each block when you reach it."}
        </p>
        <div className={styles.plan}>
          {plan.map((v, i) => {
            const c = copy[v];
            const cont = c?.group === "continuation";
            return (
              <div key={v}>
                {i > 0 && <div className={styles.pconn} />}
                <div className={`${styles.pblock}${cont ? ` ${styles.pcont}` : ""}`}>
                  <span className={styles.pnum}>{cont ? "\u221E" : i + 1}</span>
                  <div className={styles.pbody}>
                    <div className={styles.pselName}>{labelFor(v)}</div>
                    <div className={styles.pmeta}>
                      {(c?.len ?? "").toUpperCase()}
                      {c?.len && !cont ? " \u00B7 " : ""}
                      {cont ? "Ongoing baseline" : "Ends in a benchmark"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderLoadoutStep() {
    if (!selected) return null;
    // Hybrid (goal-driven) — focus-muscle chips, no template list.
    if (!loadoutKey) {
      return (
        <div className={styles.step}>
          <h2 className={styles.h1}>Build for your goals</h2>
          <p className={styles.sub}>
            {"Tell us what you\u2019re training for and we build a balanced concurrent plan around it \u2014 the more you set, the more it\u2019s tailored to you."}
          </p>
          <div className={styles.label}>Your goals</div>
          <div style={{ display: "grid", gap: 14, maxWidth: 460 }}>
            {selected.fields.map((f) => (
              <SetupFieldControl key={f.key} field={f} value={values[f.key]} onChange={(v) => setField(f.key, v)} />
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className={styles.step}>
        <h2 className={styles.h1}>{loadoutMeta?.title ?? "Configure your block"}</h2>
        <p className={styles.sub}>{loadoutMeta?.sub ?? "Choose how you\u2019ll run it."}</p>
        <div className={styles.label}>{loadoutMeta?.grouped ? "Choose a block" : "Template"}</div>
        {renderLoadoutOptions()}
        {renderSpecStrip()}
        {renderGpPlan()}
      </div>
    );
  }

  function renderBenchRow(key: string) {
    const role = benchRoleByKey.get(key);
    const bv = benchVals[key];
    if (!role || !bv) return null;
    const clusterEntry = activeTbTemplate ? cluster.find((c) => c.movement === key) : undefined;
    return (
      <div key={key} className={styles.lift}>
        <div className={styles.linfo}>
          <div className={styles.ln}>
            {movementLabel(key)}
            {clusterEntry?.split ? <span className={styles.schip}>{clusterEntry.split}</span> : null}
          </div>
          <select
            className={styles.variantSel}
            value={bv.slug}
            onChange={(e) => setBenchVariant(key, e.target.value)}
            aria-label={`${movementLabel(key)} variant`}
          >
            {role.variants.map((v) => (
              <option key={v.slug} value={v.slug}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.right}>
          <button
            type="button"
            className={styles.est}
            onClick={() => setEstimate({ key, weight: "", reps: "5" })}
          >
            Estimate
          </button>
          <span className={styles.inp}>
            <input
              type="number"
              step="any"
              value={bv.valueStr}
              onChange={(e) => setBenchValue(key, e.target.value)}
              aria-label={`${movementLabel(key)} 1-rep max`}
            />
            <span className={styles.u}>{unit}</span>
          </span>
        </div>
      </div>
    );
  }

  function renderBenchmarksStep() {
    if (!selected) return null;
    const isCluster = !!activeTbTemplate;
    const title = isCluster
      ? activeTbTemplate!.structure === "split"
        ? "Your cluster"
        : "Your strength cluster"
      : "Your benchmarks";
    const sub = isCluster
      ? "Pick the main lifts for your cluster. Enter a 1-rep max for each, or estimate it from a recent set."
      : "Enter a 1-rep max for each lift, switch the variant, or estimate from a recent set.";

    const pillText = isCluster
      ? `${clusterValidation?.ok ? "\u2713" : "\u26A0"} ${
          clusterValidation?.ok
            ? `${clusterValidation.countingLifts} main lift${clusterValidation.countingLifts === 1 ? "" : "s"}`
            : clusterValidation?.errors[0] ?? "Adjust your cluster"
        }`
      : `\u2713 ${relevantBenchKeys.length} main lift${relevantBenchKeys.length === 1 ? "" : "s"}`;

    const note =
      selected.id === "wendler-531"
        ? "Your Training Max is set to 85% of each 1RM \u2014 the 5/3/1 standard. All working percentages run off that TM."
        : "Tactical Barbell loads a submaximal % of your 1RM \u2014 no Training Max required. Switch a lift\u2019s variant from its dropdown.";

    const lockHint =
      selected.id === "wendler-531"
        ? "\uD83D\uDD12 5/3/1 always trains the four main lifts \u2014 squat, bench, deadlift and press."
        : isCluster && activeTbTemplate!.clusterMin === activeTbTemplate!.clusterMax
          ? `\uD83D\uDD12 ${activeTbTemplate!.name} uses a fixed cluster of exactly ${activeTbTemplate!.clusterMax} lifts. Swap a lift by changing its variant.`
          : null;

    return (
      <div className={styles.step} style={{ position: "relative" }}>
        <h2 className={styles.h1}>{title}</h2>
        <p className={styles.sub}>{sub}</p>

        {!hasUsableTms && (
          <p className={styles.banner}>
            {"Enter a 1-rep max for each lift below so the program can prescribe weights."}
          </p>
        )}

        <div className={styles.benchhead}>
          <div className={styles.label} style={{ margin: 0 }}>
            Units
          </div>
          <div className={styles.toggle}>
            <button type="button" className={unit === "kg" ? styles.toggleOn : undefined} onClick={() => toggleUnit("kg")}>
              KG
            </button>
            <button type="button" className={unit === "lb" ? styles.toggleOn : undefined} onClick={() => toggleUnit("lb")}>
              LB
            </button>
          </div>
          <span className={`${styles.clusterpill}${isCluster && !clusterOk ? ` ${styles.clusterpillWarn}` : ""}`}>
            {pillText}
          </span>
        </div>

        {isCluster && (
          <div style={{ marginBottom: 16 }}>
            <ClusterEditor
              template={activeTbTemplate!}
              anchoredKeys={anchoredKeys}
              cluster={cluster}
              onChange={setCluster}
              validation={clusterValidation}
            />
          </div>
        )}

        <div className={styles.lifts}>{relevantBenchKeys.map((k) => renderBenchRow(k))}</div>

        {lockHint && <div className={styles.lockhint}>{lockHint}</div>}
        <p className={styles.note}>{note}</p>

        {estimate && (
          <div className={styles.pop}>
            <h4 className={styles.popH4}>Estimate from a set</h4>
            <p className={styles.popP}>{"Enter a recent hard set and we\u2019ll work out your 1-rep max."}</p>
            <div className={styles.popfields}>
              <div className={styles.pf}>
                <label>WEIGHT</label>
                <span className={styles.pin}>
                  <input
                    type="number"
                    step="any"
                    value={estimate.weight}
                    onChange={(e) => setEstimate({ ...estimate, weight: e.target.value })}
                    aria-label="Estimate weight"
                  />
                  <span className={styles.u}>{unit}</span>
                </span>
              </div>
              <div className={styles.popx}>{"\u00D7"}</div>
              <div className={styles.pf}>
                <label>REPS</label>
                <span className={styles.pin}>
                  <input
                    type="number"
                    step="1"
                    value={estimate.reps}
                    onChange={(e) => setEstimate({ ...estimate, reps: e.target.value })}
                    aria-label="Estimate reps"
                  />
                </span>
              </div>
            </div>
            <div className={styles.popres}>
              <span className={styles.popresL}>Estimated 1RM</span>
              <span className={styles.popresV}>
                {(() => {
                  const est = epley1rm(Number(estimate.weight), Number(estimate.reps));
                  const d = unit === "lb" ? Math.round(est) : Math.round(est * 2) / 2;
                  return est > 0 ? `${d} ${unit}` : `\u2014`;
                })()}
              </span>
            </div>
            <div className={styles.popbtns}>
              <button type="button" onClick={() => setEstimate(null)}>
                Cancel
              </button>
              <button type="button" className={styles.popApply} onClick={applyEstimate}>
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderSummary() {
    if (!selected) return null;
    const ABBR: Record<string, string> = {
      squat: "SQ",
      bench: "BN",
      deadlift: "DL",
      press: "OHP",
      pullup: "PU",
    };
    const tmRow =
      relevantBenchKeys
        .map((k) => `${ABBR[k] ?? k.slice(0, 2).toUpperCase()} ${benchVals[k]?.valueStr || "\u2014"}`)
        .join(" \u00B7 ") || "\u2014";
    const tmplLabel = loadoutKey
      ? templateDisplayLabel(
          loadoutOptions.find((o) => o.value === selectedLoadoutValue)?.label ?? "\u2014",
        )
      : "Custom";
    const weekText = `${dayCounts.strength} strength \u00B7 ${dayCounts.cardio} cardio \u00B7 ${dayCounts.rest} rest`;
    return (
      <div className={styles.summary}>
        <div className={styles.srow}>
          <span className={styles.sk}>Program</span>
          <span className={styles.sv}>
            <b>{PROGRAM_LABEL[selected.id] ?? selected.name}</b>
          </span>
        </div>
        <div className={styles.srow}>
          <span className={styles.sk}>Template</span>
          <span className={styles.sv}>{tmplLabel}</span>
        </div>
        <div className={styles.srow}>
          <span className={styles.sk}>{loadoutMeta?.structLabel ?? "Structure"}</span>
          <span className={styles.sv}>{loadoutMeta?.struct ?? "\u2014"}</span>
        </div>
        <div className={styles.srow}>
          <span className={styles.sk}>Week</span>
          <span className={styles.sv}>{weekText}</span>
        </div>
        <div className={styles.srow}>
          <span className={styles.sk}>1-rep maxes</span>
          <span className={styles.sv}>{tmRow}</span>
        </div>
      </div>
    );
  }

  function renderScheduleStep() {
    if (!selected) return null;
    const countWarn = !fixedSchedule && requiredDays != null && dayCounts.strength !== requiredDays;
    const countText = countWarn
      ? `\u26A0 ${dayCounts.strength}/${requiredDays} strength days \u2014 pick ${requiredDays}`
      : `${dayCounts.strength} strength \u00B7 ${dayCounts.cardio} cardio \u00B7 ${dayCounts.rest} rest`;
    const dirty = week.some((t, i) => t !== buildWeek(requiredDays ?? freq531)[i]);
    const schednote =
      selected.id === "wendler-531"
        ? `5/3/1 gives you ${dayCounts.strength} strength days. Tap any day to make it strength, cardio or rest \u2014 keep ${requiredDays} strength days, and the rest are yours.`
        : isTb
          ? `${activeTbTemplate?.name ?? "This template"} prescribes ${requiredDays} strength days a week \u2014 you choose which. Tap the open days to add cardio or leave them as rest.`
          : "Tap any day to make it strength, cardio or rest. Your strength-day count sets how many days a week the plan trains.";

    return (
      <div className={styles.step}>
        <h2 className={styles.h1}>Set your schedule</h2>
        <p className={styles.sub}>
          {fixedSchedule
            ? `${selected.name} prescribes both your lifting and conditioning days \u2014 just pick a start date.`
            : "Your strength days come from your program. Tap any day to add cardio or leave it as rest, then pick a start date."}
        </p>

        <div style={{ marginBottom: 18 }}>
          <div className={styles.label}>Start date</div>
          <input
            type="date"
            className={styles.datein}
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
          />
        </div>

        {fixedSchedule ? (
          <p className={styles.note}>
            {`${selected.name} sets its own weekly schedule (strength and conditioning days are prescribed by the program). It owns your calendar \u2014 you just pick the start date.`}
          </p>
        ) : (
          <>
            <div className={styles.legend}>
              <span className={`${styles.lg} ${styles.lgS}`}>Strength</span>
              <span className={`${styles.lg} ${styles.lgC}`}>Cardio</span>
              <span className={`${styles.lg} ${styles.lgR}`}>Rest</span>
              <span className={`${styles.lgCount}${countWarn ? ` ${styles.lgCountWarn}` : ""}`}>{countText}</span>
            </div>
            <div className={styles.week}>
              {WD.map((label, i) => {
                const t = week[i] ?? "rest";
                const cls =
                  t === "strength" ? styles.wdStrength : t === "cardio" ? styles.wdCardio : styles.wdRest;
                const wtLabel = t === "strength" ? "Strength" : t === "cardio" ? "Cardio" : "Rest";
                return (
                  <button key={i} type="button" onClick={() => cycleDay(i)} className={`${styles.wd} ${cls}`}>
                    <span className={styles.wn}>{label}</span>
                    <span className={styles.wt}>{wtLabel}</span>
                  </button>
                );
              })}
            </div>
            {dirty && (
              <div style={{ marginTop: 12 }}>
                <button type="button" className={styles.resetbtn} onClick={resetWeek}>
                  {"\u21BA Reset to default"}
                </button>
              </div>
            )}
            <p className={styles.note}>{schednote}</p>
          </>
        )}

        {renderSummary()}
      </div>
    );
  }

  const isFinalStep = step === 3;

  return (
    <div className={styles.wizard}>
      <h1 className={styles.pageTitle}>Start a program</h1>

      <div className={styles.top}>
        <div className={styles.mark}>
          <div className={styles.diamond}>
            <span>{"S\u00D7C"}</span>
          </div>
          <b>{"Strength \u00D7 Cardio"}</b>
        </div>
        <div className={styles.stepcount}>
          STEP <b>{step + 1}</b> / 4
        </div>
      </div>

      <div className={styles.rail}>
        {STEP_LABELS.map((label, i) => (
          <div
            key={label}
            className={`${styles.seg}${i === step ? ` ${styles.segActive}` : i < step ? ` ${styles.segDone}` : ""}`}
          >
            <i />
          </div>
        ))}
      </div>
      <div className={styles.raillabels}>
        {STEP_LABELS.map((label, i) => (
          <span key={label} className={i === step ? styles.rlActive : undefined}>
            {label}
          </span>
        ))}
      </div>

      {step === 0 && renderProgramStep()}
      {step === 1 && renderLoadoutStep()}
      {step === 2 && renderBenchmarksStep()}
      {step === 3 && renderScheduleStep()}

      <div className={styles.nav}>
        {step > 0 ? (
          <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={goBack}>
            Back
          </button>
        ) : (
          <span />
        )}
        {isFinalStep ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
            {result && !result.ok && (
              <span style={{ fontSize: 13, color: "var(--warn)" }}>{result.error}</span>
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.deploy}`}
              onClick={deploy}
              disabled={!canDeploy}
            >
              {pending ? "Deploying…" : "Deploy program"}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={goNext}
            disabled={!canContinue}
          >
            Continue
          </button>
        )}
      </div>

      {modalInfo && (
        <InfoModal
          kicker={modalInfo.kick}
          title={modalInfo.title}
          body={modalInfo.body}
          meta={modalInfo.meta}
          onClose={() => setModalInfo(null)}
        />
      )}
    </div>
  );
}

/** Foundation block order for the GP plan summary. */
const GP_FOUNDATION = ["capacity", "velocity", "outcome"];

/** The four L-shaped corner ticks on a program card. */
function Ticks() {
  return (
    <>
      <span className={`${styles.tick} ${styles.tl}`} />
      <span className={`${styles.tick} ${styles.tr}`} />
      <span className={`${styles.tick} ${styles.bl}`} />
      <span className={`${styles.tick} ${styles.br}`} />
    </>
  );
}

function InfoModal({
  kicker,
  title,
  body,
  meta = [],
  onClose,
}: {
  kicker: string;
  title: string;
  body: string;
  meta?: string[];
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className={styles.modal}
    >
      <div onClick={(e) => e.stopPropagation()} className={styles.box}>
        <button type="button" onClick={onClose} aria-label="Close" className={styles.modalX}>
          {"\u2715"}
        </button>
        {kicker ? <div className={styles.modalKick}>{kicker}</div> : null}
        <h3 className={styles.modalH3}>{title}</h3>
        <p className={styles.modalP}>{body}</p>
        {meta.length > 0 && (
          <div className={styles.modalMeta}>
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClusterEditor({
  template,
  anchoredKeys,
  cluster,
  onChange,
  validation,
}: {
  template: PickerTbTemplate;
  anchoredKeys: string[];
  cluster: PickerClusterEntry[];
  onChange: (next: PickerClusterEntry[]) => void;
  validation: ClusterValidationLite | null;
}) {
  const isSplit = template.structure === "split";
  const counting = validation?.countingLifts ?? cluster.length;
  const ok = validation?.ok ?? false;

  function getEntry(movement: string): PickerClusterEntry | undefined {
    return cluster.find((c) => c.movement === movement);
  }

  function toggleClusterLift(movement: string) {
    const existing = getEntry(movement);
    if (existing) {
      onChange(cluster.filter((c) => c.movement !== movement));
      return;
    }
    if (counting >= template.clusterMax) return;
    onChange([...cluster, { movement }]);
  }

  function toggleBodyweightFourth() {
    const existing = cluster.find((c) => c.kind === "bodyweight");
    if (existing) {
      onChange(cluster.filter((c) => c !== existing));
      return;
    }
    onChange([...cluster, { movement: "pullup", kind: "bodyweight" }]);
  }

  function setSplit(movement: string, next: "A" | "B" | null) {
    const existing = getEntry(movement);
    if (next === null) {
      if (!existing) return;
      onChange(cluster.filter((c) => c.movement !== movement));
      return;
    }
    if (existing) {
      onChange(cluster.map((c) => (c.movement === movement ? { ...c, split: next } : c)));
      return;
    }
    onChange([...cluster, { movement, split: next }]);
  }

  const headline = isSplit
    ? `${template.name} splits ${template.clusterMin}+ lifts across an A and a B session.`
    : template.clusterMin === template.clusterMax
      ? `${template.name} uses exactly ${template.clusterMin} main lifts.`
      : `${template.name} uses ${template.clusterMin}-${template.clusterMax} main lifts.`;

  const summaryLine = isSplit
    ? (() => {
        const a = cluster.filter((c) => c.split === "A").map((c) => movementLabel(c.movement));
        const b = cluster.filter((c) => c.split === "B").map((c) => movementLabel(c.movement));
        return `A: ${a.length ? a.join(", ") : "—"} · B: ${b.length ? b.join(", ") : "—"}`;
      })()
    : `${counting} of ${template.clusterMax} lifts`;

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "var(--cp-text-muted, #999)" }}>
        Cluster
      </h2>
      <div style={{ fontSize: 12, color: "var(--cp-text-muted, #999)", lineHeight: 1.5 }}>{headline}</div>

      {isSplit ? (
        <div style={{ display: "grid", gap: 8 }}>
          {anchoredKeys.map((mv) => {
            const entry = getEntry(mv);
            const onA = entry?.split === "A";
            const onB = entry?.split === "B";
            return (
              <div
                key={mv}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--cp-border, rgba(255,255,255,0.14))",
                }}
              >
                <span style={{ fontSize: 13 }}>{movementLabel(mv)}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <SplitChip label="Off" active={!onA && !onB} onClick={() => setSplit(mv, null)} />
                  <SplitChip label="A" active={onA} onClick={() => setSplit(mv, "A")} />
                  <SplitChip label="B" active={onB} onClick={() => setSplit(mv, "B")} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {anchoredKeys.map((mv) => {
            const entry = getEntry(mv);
            const on = !!entry;
            const atCap = !on && counting >= template.clusterMax;
            return (
              <button
                key={mv}
                type="button"
                onClick={() => toggleClusterLift(mv)}
                disabled={atCap}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  cursor: atCap ? "not-allowed" : "pointer",
                  opacity: atCap ? 0.45 : 1,
                  background: on ? "var(--cp-accent, #6aa0ff)" : "transparent",
                  color: on ? "#0b0c0e" : "inherit",
                  border: `1px solid ${on ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                  fontWeight: on ? 600 : 400,
                  fontSize: 13,
                }}
              >
                {movementLabel(mv)}
              </button>
            );
          })}
          {template.allowsBodyweightFourth && (() => {
            const on = cluster.some((c) => c.kind === "bodyweight");
            return (
              <button
                type="button"
                onClick={toggleBodyweightFourth}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: on ? "var(--cp-accent, #6aa0ff)" : "transparent",
                  color: on ? "#0b0c0e" : "inherit",
                  border: `1px solid ${on ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                  fontWeight: on ? 600 : 400,
                  fontSize: 13,
                }}
                title="Optional bodyweight movement (does not count toward the lift cap)"
              >
                Pull-ups (bodyweight)
              </button>
            );
          })()}
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          color: ok ? "var(--cp-success, #6dbf7b)" : "var(--cp-danger, #e06c75)",
        }}
      >
        {ok ? `✓ ${summaryLine}` : validation?.errors[0] ?? summaryLine}
      </div>
    </section>
  );
}

function SplitChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        cursor: "pointer",
        background: active ? "var(--cp-accent, #6aa0ff)" : "transparent",
        color: active ? "#0b0c0e" : "inherit",
        border: `1px solid ${active ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
        fontWeight: active ? 600 : 400,
        fontSize: 12,
        minWidth: 36,
      }}
    >
      {label}
    </button>
  );
}

function SetupFieldControl({
  field,
  value,
  onChange,
}: {
  field: PickerField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const labelEl = (
    <span style={{ fontSize: 12, color: "var(--cp-text-muted, #999)" }}>
      {field.label}
      {field.help ? <span style={{ display: "block", fontSize: 11, opacity: 0.8, marginTop: 2 }}>{field.help}</span> : null}
    </span>
  );
  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    background: "transparent",
    border: "1px solid var(--cp-border, rgba(255,255,255,0.14))",
    color: "inherit",
  };

  if (field.type === "select") {
    return (
      <label style={{ display: "grid", gap: 6 }}>
        {labelEl}
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === "multi-select") {
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    const max = field.maxSelections;
    const atMax = max != null && selected.length >= max;
    return (
      <div style={{ display: "grid", gap: 6 }}>
        {labelEl}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(field.options ?? []).map((o) => {
            const on = selected.includes(o.value);
            const disabled = !on && atMax;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChange(toggleMultiSelect(selected, o.value, max))}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  cursor: disabled ? "not-allowed" : "pointer",
                  background: on ? "var(--cp-accent, #6aa0ff)" : "transparent",
                  color: on ? "#0b0c0e" : "inherit",
                  border: `1px solid ${on ? "var(--cp-accent, #6aa0ff)" : "var(--cp-border, rgba(255,255,255,0.14))"}`,
                  fontWeight: on ? 600 : 400,
                  fontSize: 12,
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {max != null ? (
          <span style={{ fontSize: 11, color: "var(--cp-text-muted, #999)" }}>
            {selected.length}/{max} selected
          </span>
        ) : null}
      </div>
    );
  }
  if (field.type === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {labelEl}
      </label>
    );
  }
  // number (and any future numeric-ish field) — text fields fall through to here too.
  return (
    <label style={{ display: "grid", gap: 6 }}>
      {labelEl}
      <input
        type="number"
        step="any"
        value={value === undefined || value === null || value === "" ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        style={inputStyle}
      />
    </label>
  );
}
