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
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";
import {
  AB_TRIAD_MOVEMENTS,
  activationPhaseForWeek,
  type ActivationPhaseKey,
} from "@hta/tacticalbarbell";
import {
  createProgramInstance,
  getProgramSegments,
  type CreateProgramInstanceResult,
  type ProgramSegmentOption,
} from "@/lib/platform/actions";
import {
  TB_DEFAULT_ACCESSORY_MUSCLES,
  tbAccessoryPlanForTemplate,
} from "@/lib/platform/tb-accessories-config";
import { upsertTrainingMax } from "@/lib/training-maxes/actions";
import {
  DEFAULT_CUSTOM_TB_NAME,
  TB_ACTIVATION_CUSTOMIZATION_VERSION,
  TB_CUSTOMIZATION_VERSION,
  activationSessionConfigs,
  activationRehabAssignments,
  isTbActivationCustomization,
  isTbCustomizationV1,
  type TbActivationCustomizationV3,
  type TbCustomization,
} from "@/lib/platform/tb-customization";
import styles from "./ProgramPicker.module.css";
import { SessionLinkEditor, type LinkableMovement } from "./SessionLinkEditor";
import { LinkBadge, rowLinkClass } from "./LinkBadge";
import {
  activationLinkableMovements,
  pruneMovementFromLinks,
  slotLinkBadges,
} from "./session-link-editing";
import {
} from "@/lib/platform/rehab-links";
import {
  SESSION_LINKS_VERSION,
  type SessionLink,
  type SessionLinks,
} from "@/lib/platform/session-links";
import {
  attachProtocols,
  pruneAssignments,
  pruneRehabLinks,
} from "@/lib/rehab-protocols/attachment";

/** Stencil "code" + Oswald kicker shown on each program card (step 1). */
const CARD_META: Record<string, { kick: string; code: string }> = {
  hybrid: { kick: "Hybrid", code: "Build your own" },
  "wendler-531": { kick: "Wendler", code: "5/3/1" },
  "tactical-barbell": { kick: "Tactical Barbell", code: "TB" },
  "green-protocol": { kick: "Tactical Barbell", code: "GP" },
  hyrox: { kick: "Hybrid Racing", code: "HYROX" },
};

/**
 * Short, high-level card descriptor (a few words). The long description lives in
 * the info modal (PROG_INFO), not on the tile.
 */
const CARD_TAGLINE: Record<string, string> = {
  "wendler-531": "Percentage strength",
  "tactical-barbell": "Operator · Fighter · Zulu · Activation",
  "green-protocol": "Strength + endurance",
  hybrid: "Personalised strength + cardio",
  hyrox: "Run + functional stations",
};

/** Display order of the program cards (5/3/1 → TB → GP → HYROX → Build-your-own). */
const CARD_ORDER = ["wendler-531", "tactical-barbell", "green-protocol", "hyrox", "hybrid"];

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
  kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored";
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
  fixedLoadout?: boolean;
  fixedSchedule?: boolean;
  requiredBenchmarkKeys?: string[];
  startSchedules?: PickerStartSchedule[];
  defaultCluster: PickerClusterEntry[];
  sessionSeries?: Array<{
    key: string;
    label: string;
    /**
     * What the template prescribes in this repeating strength slot, in order.
     * `sourceMovement` is the slot's permanent identity: it is what a
     * replacement inherits its prescription from, and what a superset link is
     * keyed by, so both survive swapping the exercise that fills the slot.
     */
    slots: Array<{
      sourceMovement: string;
      role: "main" | "supplemental";
      kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored";
      split?: "A" | "B";
    }>;
  }>;
  activationPhases?: PickerActivationPhase[];
}

export interface PickerActivationPhase {
  key: ActivationPhaseKey;
  label: string;
  weeks: string;
  sessions: Array<{
    key: string;
    label: string;
    type: "strength" | "conditioning";
    defaultDay: number;
    movements: Array<{
      sourceMovement: string;
      role?: "main" | "supplemental";
      kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored";
    }>;
  }>;
}


type PickerSeriesSlot = NonNullable<
  PickerTbTemplate["sessionSeries"]
>[number]["slots"][number];

/**
 * One editable row in a customized strength slot.
 *
 * `sourceMovement` is the template slot the row fills; `movement` is whatever
 * exercise currently fills it. They differ once the user swaps the exercise,
 * and the slot is what the engine matches its prescription rules against — so a
 * swapped supplemental keeps its supplemental sets, reps and percentage. A row
 * the user added themselves has no slot and is prescribed as main work.
 */
interface SeriesSlotDraft {
  sourceMovement?: string;
  movement: string;
  kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored";
  /** Set on a movement the user added; it is prescribed as accessory work. */
  role?: "accessory";
}

/**
 * The slot a row belongs to. Customizations written before slots were recorded
 * carry only a movement key, which for an unswapped row IS its slot — the same
 * fallback the engine applies.
 */
function slotIdentity(draft: SeriesSlotDraft): string {
  return draft.sourceMovement ?? draft.movement;
}

function slotDraftsFor(
  series: NonNullable<PickerTbTemplate["sessionSeries"]>[number],
): SeriesSlotDraft[] {
  return series.slots.map((slot) => ({
    sourceMovement: slot.sourceMovement,
    movement: slot.sourceMovement,
    ...(slot.kind ? { kind: slot.kind } : {}),
  }));
}

function slotOf(
  series: NonNullable<PickerTbTemplate["sessionSeries"]>[number],
  draft: SeriesSlotDraft,
): PickerSeriesSlot | undefined {
  if (draft.role === "accessory") return undefined;
  const identity = slotIdentity(draft);
  return series.slots.find((slot) => slot.sourceMovement === identity);
}

/**
 * Movements that make sense at an accessory dose (8–15 reps, near failure).
 * Isolation work only: a carry, a plyometric or an Olympic lift cannot share
 * that prescription, so offering them here would produce nonsense.
 */
const ACCESSORY_PATTERN = "isolation";

function sessionSeriesFor(template: PickerTbTemplate): NonNullable<
  PickerTbTemplate["sessionSeries"]
> {
  return template.sessionSeries?.length
    ? template.sessionSeries
    : Array.from({ length: template.sessionsPerWeek }, (_, index) => ({
        key: `slot-${index + 1}`,
        label: `Day ${index + 1}`,
        slots: template.defaultCluster.map((entry) => ({
          sourceMovement: entry.movement,
          role: "main" as const,
          ...(entry.kind ? { kind: entry.kind } : {}),
          ...(entry.split ? { split: entry.split } : {}),
        })),
      }));
}

export interface PickerStartSchedule {
  startWeekIndex: number;
  label: string;
  strength: number;
  cardio: number;
  rest: number;
}

/** TB program id (matches the engine's program family / id). */
const TB_PROGRAM_ID = "tactical-barbell";
const CANONICAL_BENCH_KEYS = new Set(["squat", "bench", "deadlift", "press"]);
const DEFAULT_ARMOR_SUPPLEMENTAL_A = "back-extension";
const DEFAULT_ARMOR_SUPPLEMENTAL_B = "pullup";

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

export interface PickerRehabMovement {
  id: string;
  name: string;
  slug: string;
  pattern: string;
  hasOneRm: boolean;
}

/**
 * A protocol from the user's Settings library, ready to attach to a program.
 * `items` and `links` are already validated and typed — the wizard no longer
 * authors them, so it does not re-parse them either.
 */
export interface PickerLibraryProtocol {
  id: string;
  name: string;
  items: SerializedRehabItem[];
  links: SessionLink[];
  /** "4 movements · 12 sets · ~32 min", derived by the canonical estimator. */
  summary: string;
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
    body: "The most trusted \u201Cget strong slowly\u201D barbell plan. It\u2019s built on a simple idea: start lighter than you think, add a little weight every few weeks, focus on the big lifts \u2014 squat, bench, deadlift and overhead press \u2014 and aim to beat your old numbers by a rep or two rather than maxing out.\n\nYou train off a conservative working weight, so sessions feel manageable and you almost never miss. Each block pushes for a few weeks, then eases off to let you recover.\n\nPatience is the whole point: it\u2019s designed to keep you progressing for years, not weeks. Best if your main goal is raw barbell strength and you want a proven, low-stress routine.",
    meta: ["4 main lifts", "Slow, steady strength"],
  },
  [TB_PROGRAM_ID]: {
    kick: "Tactical Barbell",
    title: "Tactical Barbell",
    body: "Strength training for people who also have to run, ruck, fight \u2014 or just have a life outside the gym. It was written by a tactical operator who needed to stay very strong without living under the barbell, so the sessions are short (often 20\u201330 minutes) and you lift at controlled, submaximal weights: hard work, but never grinding to failure.\n\nThat leaves plenty of energy for conditioning and sport. You pick a small handful of main lifts and train them often, following a percentage plan that climbs over a 6-week block before you retest your maxes.\n\nTemplates like Operator, Fighter and Zulu simply change how many days a week you lift and how many lifts you carry. Best if you want to be strong and keep doing cardio or hybrid training.",
    meta: ["Strength + conditioning", "Short 20\u201330 min sessions"],
  },
  "green-protocol": {
    kick: "Tactical Barbell \u00B7 Green Protocol",
    title: "Green Protocol",
    body: "Tactical Barbell\u2019s bigger sibling, for people who need serious endurance on top of strength \u2014 think military selection, tactical roles, or any hybrid athlete chasing an ultra-runner\u2019s engine with real barbell strength.\n\nInstead of just programming your lifts, it programs your running and rucking too: you build a wide aerobic base first, then ramp up intensity toward a goal. It runs in longer phases \u2014 Hybrid is the everyday baseline you can stay on indefinitely, while blocks like Capacity, Velocity and Outcome peak you for a specific event.\n\nThe guiding idea is to build the foundation gradually: the wider the base, the higher the peak. Your lifting plan is shown here in the app; you log your runs and rucks yourself. Best when endurance matters as much as strength.",
    meta: ["Strength + endurance", "Event & selection prep"],
  },
  hybrid: {
    kick: "Hybrid",
    title: "Build your own",
    body: "The do-it-all option: tell us roughly what you want \u2014 how many days a week you can train and which muscles to bias \u2014 and the app builds a balanced concurrent plan that trains strength and conditioning side by side.\n\nIt runs off the same four main lifts as everything else, so your numbers and history carry straight over, and it quietly keeps strength and cardio in balance so neither crowds the other out.\n\nThere\u2019s no fixed recipe to follow: the plan adapts to the days you give it. Best if you want a bit of everything \u2014 strength, muscle and an engine \u2014 without committing to a single named methodology.",
    meta: ["Strength + cardio", "Adapts to your goals"],
  },
  hyrox: {
    kick: "Hybrid Racing",
    title: "HYROX",
    body: "Race-specific training for HYROX \u2014 the standardised fitness race of eight 1 km runs alternating with eight functional stations (ski erg, sled push & pull, burpee broad jumps, row, farmers carry, sandbag lunges and wall balls).\n\nThe plan periodises toward race day: a Base block builds your aerobic engine and a strength foundation, Build adds heavy strength and threshold running, Race-prep sharpens the signature \u201Ccompromised running\u201D (running hard on legs pre-fatigued by the stations) plus station circuits and a simulation or two, then a Taper leaves you fresh for the start line.\n\nYou log your running and ergs yourself; the loaded stations log against the standardised division weights. Pick your experience level (it sets a 10\u201316 week build), your division (Open / Pro / Doubles) and how many days a week you can train. Best if you\u2019re targeting a HYROX event.",
    meta: ["Run + stations", "Event-targeted \u00B7 10\u201316 weeks"],
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
    title: "Configure your 5/3/1 cycle",
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
    struct: "Prescribed in-app \u00B7 runs & rucks logged by you",
    grouped: true,
  },
  hyrox: {
    title: "Configure your HYROX build",
    sub: "Pick your experience level (it sets a 10\u201316 week build), your division and how many days a week you can train. The plan periodises toward race day.",
    structLabel: "Phases",
    struct: "Base \u2192 Build \u2192 Race-prep \u2192 Taper",
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
    "original-531-fsl": {
      desc: "Classic 5/3/1 main with AMRAP top sets plus a First-Set-Last back-off.",
      long: "The original 5/3/1: each week the top set is taken for As-Many-Reps-As-Possible (stopping shy of failure), and those reps drive your estimated 1RM and Training-Max progression. FSL back-off sets add supplemental volume. More autoregulated and intense than 5\u2019s PRO \u2014 a good next step once you\u2019re comfortable with the system.",
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
      desc: "A/B split \u2014 4 sessions a week, each with main and supplemental lifts.",
      freq: "4 sessions / week",
      len: "6-week block",
      long: "Zulu runs two sessions, A and B, twice each across four days. A trains bench and squat, then overhead press and ab work. B trains deadlift and weighted pull-ups, then barbell rows and back extensions. The second pass through the week opens slightly heavier than the first. More barbell coverage than Operator, for when you can give strength 4 days.",
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
    activation: {
      badge: "25-week on-ramp",
      desc: "Base, Armor, Operator and Vertex in one guided progression.",
      freq: "2\u20134 strength sessions / week",
      len: "25-week program",
      long: "Activation is the complete TB3 on-ramp in one program. It starts with four weeks of strength-endurance circuits, tests the lifts, moves through Armor and Operator Blue/Black, then finishes with the explosive Vertex/Breacher phase and a final retest. Each phase owns its exercise selection and schedule. Conditioning guidance stays outside this strength-only plan.",
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
  "barbell-row": "Barbell Row",
  "pendlay-row": "Pendlay Row",
  "rack-pull": "Rack Pull",
  "weighted-pullup": "Weighted Pull-up",
  "back-extension": "Back Extension",
  "reverse-hyper": "Reverse Hyperextension",
  "overhead-press": "Overhead Press",
  "power-clean": "Power Clean",
  "push-press": "Push Press",
  pushup: "Push-up",
  "goblet-squat": "Goblet Squat",
  "inverted-row": "Inverted Row",
  "hanging-leg-raise": "Hanging Leg Raise",
  "hanging-knee-raise": "Hanging Knee Raise",
  "toes-to-bar": "Toes-to-Bar",
  "jump-squat": "Jump Squat",
  "plyo-pushup": "Plyometric Push-up",
};

const AB_TRIAD_SOURCES = [
  "hanging-leg-raise",
  "hanging-knee-raise",
  "toes-to-bar",
] as const;
const AB_TRIAD_SOURCE_SET: ReadonlySet<string> = new Set(AB_TRIAD_SOURCES);
/**
 * Picker row identity for the AB Triad group.
 *
 * Deliberately not one of the triad's own movements: the row stands for all
 * three, and reusing a member's key would make that member's name resolve to
 * "AB Triad" everywhere a link is displayed member by member.
 */
const AB_TRIAD_GROUP_KEY = "group:tb-ab-triad";

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

type DayType = "strength" | "cardio" | "rehab" | "rest";

/** A rehab item exactly as the customization stores it. */
export type SerializedRehabItem = {
  movementId: string;
  movementName: string;
  side?: "both" | "left" | "right";
  sets: number;
  reps?: number;
  holdSeconds?: number;
  targetWeightKg?: number;
  instructions?: string;
};

type ActivationSessionDraft = {
  day: number;
  enabled: boolean;
  movements: Record<string, string | null>;
};

type ActivationPhaseDraft = {
  sessions: Record<string, ActivationSessionDraft>;
  rehabAssignments: Record<number, string>;
};

type ActivationDrafts = Record<ActivationPhaseKey, ActivationPhaseDraft>;

function catalogMovementKey(id: string): string {
  return `catalog:${id}`;
}

function catalogMovementMetaFromCustomization(
  customization: TbCustomization | undefined,
): Record<string, PickerRehabMovement> {
  if (!customization) return {};
  const movements = isTbCustomizationV1(customization)
    ? Object.values(customization.sessionMovements).flat()
    : Object.values(activationSessionConfigs(customization)).flatMap(
        (session) =>
          Object.values(session.movementOverrides).filter(
            (movement) => movement != null,
          ),
      );
  return Object.fromEntries(
    movements.flatMap((movement) =>
      movement.movement.startsWith("catalog:") &&
      movement.movementId &&
      movement.slug &&
      movement.displayName
        ? [
            [
              movement.movement,
              {
                id: movement.movementId,
                name: movement.displayName,
                slug: movement.slug,
                pattern: "custom",
                hasOneRm: movement.kind !== "unanchored",
              },
            ],
          ]
        : [],
    ),
  );
}

function ExerciseLibraryPicker({
  movements,
  onPick,
  excludeKeys = [],
}: {
  movements: PickerRehabMovement[];
  onPick: (movement: PickerRehabMovement) => void;
  excludeKeys?: string[];
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const matches = movements
    .filter(
      (movement) =>
        !excludeKeys.includes(catalogMovementKey(movement.id)) &&
        (!normalized ||
          movement.name.toLowerCase().includes(normalized) ||
          movement.slug.toLowerCase().includes(normalized) ||
          movement.pattern.toLowerCase().includes(normalized)),
    )
    .slice(0, 12);
  return (
    <div className={styles.libraryPicker}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the exercise library"
        aria-label="Search the exercise library"
      />
      <div className={styles.libraryResults}>
        {matches.map((movement) => (
          <button
            key={movement.id}
            type="button"
            onClick={(event) => {
              onPick(movement);
              setQuery("");
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span>
              <b>{movement.name}</b>
              <small>{movement.pattern.replace(/_/g, " ")}</small>
            </span>
            <em>{movement.hasOneRm ? "Uses saved 1RM" : "Manual load"}</em>
          </button>
        ))}
        {matches.length === 0 ? <p>No matching exercises.</p> : null}
      </div>
    </div>
  );
}

function defaultActivationDrafts(
  template: PickerTbTemplate | null,
  armorSupplementalA: "back-extension" | "reverse-hyper" =
    DEFAULT_ARMOR_SUPPLEMENTAL_A,
  armorSupplementalB: "pullup" | "inverted-row" =
    DEFAULT_ARMOR_SUPPLEMENTAL_B,
): ActivationDrafts {
  const empty = (): ActivationPhaseDraft => ({
    sessions: {},
    rehabAssignments: {},
  });
  const drafts: ActivationDrafts = {
    base: empty(),
    armor: empty(),
    operator: empty(),
    vertex: empty(),
  };
  for (const phase of template?.activationPhases ?? []) {
    drafts[phase.key] = {
      sessions: Object.fromEntries(
        phase.sessions.map((session) => [
          session.key,
          {
            day: session.defaultDay,
            enabled: true,
            movements: Object.fromEntries(
              session.movements.map((movement) => [
                movement.sourceMovement,
                movement.sourceMovement,
              ]),
            ),
          },
        ]),
      ),
      rehabAssignments: {},
    };
  }
  for (const session of Object.values(drafts.armor.sessions)) {
    if ("back-extension" in session.movements) {
      session.movements["back-extension"] = armorSupplementalA;
    }
    if ("pullup" in session.movements) {
      session.movements.pullup = armorSupplementalB;
    }
  }
  return drafts;
}

function activationDraftsFromCustomization(
  template: PickerTbTemplate | null,
  customization: TbCustomization | undefined,
  armorSupplementalA: "back-extension" | "reverse-hyper" =
    DEFAULT_ARMOR_SUPPLEMENTAL_A,
  armorSupplementalB: "pullup" | "inverted-row" =
    DEFAULT_ARMOR_SUPPLEMENTAL_B,
): ActivationDrafts {
  const drafts = defaultActivationDrafts(
    template,
    armorSupplementalA,
    armorSupplementalB,
  );
  if (!customization || !isTbActivationCustomization(customization)) {
    return drafts;
  }
  for (const phase of template?.activationPhases ?? []) {
    const stored = customization.phases[phase.key];
    drafts[phase.key].rehabAssignments = Object.fromEntries(
      activationRehabAssignments(customization, phase.key).map(
        (assignment) => [assignment.day, assignment.protocolId],
      ),
    );
    for (const session of phase.sessions) {
      const config = stored.sessions[session.key];
      if (!config) continue;
      const movements = drafts[phase.key].sessions[session.key]!.movements;
      for (const [source, replacement] of Object.entries(
        config.movementOverrides,
      )) {
        movements[source] = replacement?.movement ?? null;
      }
      drafts[phase.key].sessions[session.key] = {
        day: config.day,
        enabled: config.enabled,
        movements,
      };
    }
  }
  return drafts;
}

/**
 * 5/3/1 two-day lift pairings. With 2 training days the engine pairs the four
 * main lifts into two sessions by chunking `dayOrder` into twos — so each preset
 * is just the day order that yields that pairing. These three partitions are the
 * ONLY ways to split four lifts into two pairs, so they fully cover the space.
 */
type PairingId = "default" | "press-squat" | "upper-lower";
const PAIRINGS: {
  id: PairingId;
  dayOrder: string[];
  /** Short scannable name for the split. */
  name: string;
  /** The two lifts trained on each of the two days. */
  dayA: string;
  dayB: string;
}[] = [
  {
    id: "default",
    dayOrder: ["press", "deadlift", "bench", "squat"],
    name: "Press + pull, then push + squat",
    dayA: "Overhead Press + Deadlift",
    dayB: "Bench + Squat",
  },
  {
    id: "press-squat",
    dayOrder: ["press", "squat", "deadlift", "bench"],
    name: "Overhead day, then bench day",
    dayA: "Overhead Press + Squat",
    dayB: "Deadlift + Bench",
  },
  {
    id: "upper-lower",
    dayOrder: ["bench", "press", "squat", "deadlift"],
    name: "Upper / lower split",
    dayA: "Bench + Overhead Press",
    dayB: "Squat + Deadlift",
  },
];

/** Build a default week: `n` strength days on the canonical spread, rest elsewhere. */
function buildWeek(n: number): DayType[] {
  const clamped = Math.max(1, Math.min(7, n));
  const spread = DAY_SPREADS[clamped] ?? DAY_SPREADS[4]!;
  const w: DayType[] = Array.from({ length: 7 }, () => "rest");
  for (const d of spread) w[d] = "strength";
  return w;
}

/** Build a week from explicit strength + cardio weekdays (edit-mode prefill). */
function buildWeekFrom(
  strengthDays: number[],
  cardioDays: number[],
  customization?: TbCustomization,
): DayType[] {
  if (customization && isTbCustomizationV1(customization)) {
    return customization.dayTypes.map((day) =>
      day === "conditioning" ? "cardio" : day,
    );
  }
  const w: DayType[] = Array.from({ length: 7 }, () => "rest");
  for (const d of cardioDays) if (d >= 0 && d <= 6) w[d] = "cardio";
  // Strength wins any collision so the strength-day count stays correct.
  for (const d of strengthDays) if (d >= 0 && d <= 6) w[d] = "strength";
  return w;
}
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
  _anchoredKeys: string[],
): PickerClusterEntry[] {
  void _anchoredKeys;
  return template.defaultCluster.map((c) => ({
    movement: c.movement,
    ...(c.split ? { split: c.split } : {}),
    ...(c.kind ? { kind: c.kind } : {}),
  }));
}

export function relevantBenchmarkKeysFor(
  template: PickerTbTemplate | null,
  cluster: PickerClusterEntry[],
  benchRoles: PickerBenchRole[],
): string[] {
  const roleKeys = benchRoles.map((role) => role.engineKey);
  const available = new Set(roleKeys);
  if (!template) {
    return roleKeys.filter((key) => CANONICAL_BENCH_KEYS.has(key));
  }
  return cluster
    .filter(
      (entry) =>
        // Bodyweight and unanchored lifts are prescribed by effort, not off a
        // training max, so asking for one would ask for a number that does not
        // exist. `unanchored` is the same signal the engine uses to skip the
        // percentage (see `prescribe`), so the two can never disagree.
        entry.kind !== "bodyweight" &&
        entry.kind !== "unanchored" &&
        available.has(entry.movement),
    )
    .map((entry) => entry.movement)
    .concat(template.requiredBenchmarkKeys ?? [])
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort((a, b) => roleKeys.indexOf(a) - roleKeys.indexOf(b));
}

export function startScheduleFor(
  template: PickerTbTemplate | null,
  startWeekIndex: number,
): PickerStartSchedule | null {
  return (
    template?.startSchedules?.find(
      (schedule) => schedule.startWeekIndex === startWeekIndex,
    ) ?? null
  );
}

export function activationRequiredBenchmarkKeysFor(
  startWeekIndex: number,
): string[] {
  if (startWeekIndex <= 4) return [];
  if (startWeekIndex <= 7) {
    return [
      "squat",
      "bench",
      "deadlift",
      "barbell-row",
      "rack-pull",
      "overhead-press",
    ];
  }
  if (startWeekIndex <= 19) {
    return ["squat", "bench", "deadlift", "barbell-row"];
  }
  if (startWeekIndex === 20 || startWeekIndex >= 24) return [];
  return [
    "squat",
    "bench",
    "barbell-row",
    "pendlay-row",
    "power-clean",
    "push-press",
  ];
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

/**
 * The upcoming Monday (YYYY-MM-DD) on or after `ymd` — `ymd` itself when it is
 * already a Monday. Programs lay out as full Mon–Sun weeks (the read side
 * anchors week 1 to the Monday of `started_on`), so defaulting a fresh program
 * to the upcoming Monday gives a clean week 1 with no past days — otherwise a
 * mid-week start strands the earlier weekdays as instantly-overdue sessions.
 */
function upcomingMondayYmd(ymd: string): string {
  // Parse as a local calendar date (no TZ shift) and find ISO weekday (Mon=0).
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const isoWeekday = (dt.getDay() + 6) % 7; // JS Sun=0 → Mon=0…Sun=6
  if (isoWeekday === 0) return ymd;
  dt.setDate(dt.getDate() + (7 - isoWeekday));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export interface ProgramEditContextProp {
  blockId: string;
  programId: string;
  setupValues: Record<string, unknown>;
  strengthWeekdays: number[];
  cardioWeekdays: number[];
  startedOn: string;
  accessoriesEnabled: boolean;
  customization?: TbCustomization;
  /** User-authored superset links, rehydrated into the link editor. */
  sessionLinks?: SessionLinks;
  currentWeekIndex?: number;
  programStartWeekIndex?: number;
}

export function activationSummaryPhaseFor(
  startWeekIndex: number,
  editContext?: Pick<
    ProgramEditContextProp,
    "currentWeekIndex" | "programStartWeekIndex"
  >,
): ActivationPhaseKey | null {
  const summaryWeekIndex =
    editContext?.currentWeekIndex == null
      ? startWeekIndex
      : (editContext.programStartWeekIndex ?? 0) +
        editContext.currentWeekIndex;
  for (
    let week = Math.max(1, Math.trunc(summaryWeekIndex) + 1);
    week <= 25;
    week += 1
  ) {
    const phase = activationPhaseForWeek(week);
    if (phase) return phase;
  }
  return null;
}

export function ProgramPicker({
  programs,
  anchoredKeys,
  tbTemplates = [],
  benchRoles = [],
  pullupMovement,
  rehabMovements = [],
  libraryProtocols = [],
  existingRehabBindings = {},
  initialProgramId,
  initialLoadoutValue,
  editContext,
  seasonBlockId,
  prefillRaceDate,
}: {
  programs: PickerProgram[];
  anchoredKeys: string[];
  tbTemplates?: PickerTbTemplate[];
  benchRoles?: PickerBenchRole[];
  pullupMovement?: { movementId: string; currentMaxReps?: number };
  rehabMovements?: PickerRehabMovement[];
  /** The user's rehab library — authored in Settings, selected here. */
  libraryProtocols?: PickerLibraryProtocol[];
  /**
   * For an edited program: `libraryProtocolId → the local id it already uses`.
   * Preserving those ids is what stops a deployed program's supersets, day
   * assignments and deleted-rehab tombstones stopping matching on its first
   * edit after the library landed.
   */
  existingRehabBindings?: Record<string, string>;
  /** Deep-link preselect: a program id to open the wizard on (e.g. guided advance). */
  initialProgramId?: string;
  /** Deep-link preselect: the loadout value for that program (Green Protocol phaseId). */
  initialLoadoutValue?: string;
  /** Edit mode: re-enter the wizard for an active plan, prefilled + program-locked. */
  editContext?: ProgramEditContextProp;
  /** Season roadmap deep-link (ADR 0051): the planned season_block to activate on deploy. */
  seasonBlockId?: string;
  /**
   * HYROX only (ADR 0060): pre-fill the optional race date. Set when this wizard
   * is opened for a season PEAK block whose season targets an event date — so the
   * block tapers to that event instead of running as raceless maintenance. The
   * user can still clear it.
   */
  prefillRaceDate?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateProgramInstanceResult | null>(null);
  const [modalInfo, setModalInfo] = useState<ProgInfo | null>(null);

  // Edit mode: re-enter the wizard for an active plan. Behaves like a locked
  // preselect — start on Loadout, program fixed, schedule/loadout prefilled from
  // the live block. Changes apply only to untouched sessions after today.
  const editProgram = editContext
    ? programs.find((p) => p.id === editContext.programId) ?? null
    : null;
  const isEditing = !!editContext && !!editProgram;

  // Deep-link preselect (guided advance): when the route carries ?program=&phase=
  // (e.g. the Today "Set up Velocity →" nudge), open the wizard already on that
  // enabled program with the next phase pre-chosen, landing on the Loadout step so
  // the user can fine-tune (cluster, schedule) before deploying. Derived from props
  // straight into the initial state below — no effects, no render-phase mutation.
  const preselectProgram =
    editProgram ??
    (initialProgramId ? programs.find((p) => p.id === initialProgramId && p.enabled) ?? null : null);
  function preselectValues(): Record<string, unknown> {
    if (isEditing && editContext) {
      return { ...defaultValuesFor(editProgram!.fields), ...editContext.setupValues };
    }
    if (!preselectProgram) return {};
    const base = defaultValuesFor(preselectProgram.fields);
    const key = loadoutFieldKey(preselectProgram.id);
    if (key && initialLoadoutValue) base[key] = initialLoadoutValue;
    return base;
  }

  // Wizard step (0 Program · 1 Loadout · 2 Benchmarks · 3 Schedule).
  const [step, setStep] = useState<number>(preselectProgram ? 1 : 0);
  // Furthest step reached — the progress rail lets you jump back to any visited step.
  const [maxStep, setMaxStep] = useState<number>(preselectProgram ? 1 : 0);

  // No pre-selection unless deep-linked: the user picks a program on step 1.
  const [selectedId, setSelectedId] = useState<string>(preselectProgram?.id ?? "");
  const selected = programs.find((p) => p.id === selectedId) ?? null;

  const [values, setValues] = useState<Record<string, unknown>>(preselectValues);
  const [startedOn, setStartedOn] = useState<string>(
    isEditing && editContext ? editContext.startedOn : upcomingMondayYmd(todayYmd()),
  );
  const [raceDate, setRaceDate] = useState<string>(prefillRaceDate ?? "");
  // Start point (the program phase/block to begin from). Default 0 = beginning.
  const [segments, setSegments] = useState<ProgramSegmentOption[]>([]);
  const [startWeekIndex, setStartWeekIndex] = useState<number>(0);
  const [segmentsLoading, setSegmentsLoading] = useState<boolean>(false);

  // Load the program's structural start points (phases/blocks) once the user
  // reaches the Schedule step, refreshing if the loadout or race date changes.
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    if (step !== 3 || !selectedId) {
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSegmentsLoading(true);
    void getProgramSegments({
      programId: selectedId,
      setupValues: values,
      startedOn,
      ...(selectedId === "hyrox" && raceDate ? { raceDate } : {}),
    })
      .then((res) => {
        if (cancelled) return;
        const segs = res.ok ? res.segments : [];
        setSegments(segs);
        // Keep the current choice only if it's still a valid boundary.
        setStartWeekIndex((prev) =>
          segs.some((s) => s.startWeekIndex === prev) ? prev : 0,
        );
      })
      .finally(() => {
        if (!cancelled) setSegmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedId, startedOn, raceDate, valuesKey]);

  // Weekly schedule grid: 7 day cells. The strength days become deploy `weekdays`.
  const [week, setWeek] = useState<DayType[]>(() =>
    isEditing && editContext
      ? buildWeekFrom(
          editContext.strengthWeekdays,
          editContext.cardioWeekdays,
          editContext.customization,
        )
      : buildWeek(preselectProgram?.sessionsPerWeek ?? 4),
  );
  // 5/3/1 lets the user pick strength frequency; other programs derive it.
  const [freq531, setFreq531] = useState<number>(
    isEditing && editContext?.programId === "wendler-531"
      ? Math.max(1, Math.min(7, editContext.strengthWeekdays.length))
      : preselectProgram?.id === "wendler-531"
        ? (preselectProgram.sessionsPerWeek ?? 4)
        : 4,
  );
  // 5/3/1 2-day lift pairing (which two lifts share each session). Only used when
  // 5/3/1 runs at 2 days/week; ignored otherwise.
  const [pairing, setPairing] = useState<PairingId>("default");
  const [unit, setUnit] = useState<Unit>("kg");

  // Per-lift 1RM entry: a display-unit string + chosen variant slug, keyed by engine key.
  const [benchVals, setBenchVals] = useState<Record<string, { slug: string; valueStr: string }>>(
    () => (preselectProgram ? initBenchVals("kg") : {}),
  );
  const [benchTouched, setBenchTouched] = useState<Set<string>>(new Set());
  const [estimate, setEstimate] = useState<{ key: string; weight: string; reps: string } | null>(null);
  // Operator's optional bodyweight pull-up: max clean reps the engine prescribes off.
  const [pullupReps, setPullupReps] = useState<string>(
    pullupMovement?.currentMaxReps != null ? String(pullupMovement.currentMaxReps) : "10",
  );

  const benchRoleByKey = useMemo(() => {
    const m = new Map<string, PickerBenchRole>();
    for (const r of benchRoles) m.set(r.engineKey, r);
    return m;
  }, [benchRoles]);
  const [catalogMovementMeta, setCatalogMovementMeta] = useState<
    Record<string, PickerRehabMovement>
  >(() => {
    const stored = catalogMovementMetaFromCustomization(
      editContext?.customization,
    );
    return Object.fromEntries(
      Object.entries(stored).map(([key, movement]) => {
        const current = rehabMovements.find(
          (candidate) => candidate.id === movement.id,
        );
        return [key, current ?? movement];
      }),
    );
  });

  const isTb = selected?.id === TB_PROGRAM_ID;
  const isGp = selected?.id === "green-protocol";
  const isHybrid = selected?.id === "hybrid";
  const isHyrox = selected?.id === "hyrox";
  const tbTemplateById = useMemo(() => {
    const m = new Map<string, PickerTbTemplate>();
    for (const t of tbTemplates) m.set(t.id, t);
    return m;
  }, [tbTemplates]);

  const tbTemplateId = isTb ? String(values.templateId ?? "") : "";
  const activeTbTemplate = isTb ? tbTemplateById.get(tbTemplateId) ?? null : null;
  const activationMovementKindByKey = useMemo(() => {
    const kinds = new Map<
      string,
      "barbell" | "weighted-bw" | "bodyweight" | "unanchored"
    >();
    for (const phase of activeTbTemplate?.activationPhases ?? []) {
      for (const session of phase.sessions) {
        for (const movement of session.movements) {
          kinds.set(
            movement.sourceMovement,
            movement.kind ?? "barbell",
          );
        }
      }
    }
    for (const role of benchRoles) {
      if (!kinds.has(role.engineKey)) kinds.set(role.engineKey, "barbell");
    }
    for (const [key, movement] of Object.entries(catalogMovementMeta)) {
      kinds.set(key, movement.hasOneRm ? "barbell" : "unanchored");
    }
    return kinds;
  }, [activeTbTemplate, benchRoles, catalogMovementMeta]);
  const customMovementLabel = (key: string) =>
    catalogMovementMeta[key]?.name ?? movementLabel(key);
  const isActivation = activeTbTemplate?.id === "activation";
  const armorSupplementalA =
    values.armorSupplementalA === "reverse-hyper"
      ? "reverse-hyper"
      : DEFAULT_ARMOR_SUPPLEMENTAL_A;
  const armorSupplementalB =
    values.armorSupplementalB === "inverted-row"
      ? "inverted-row"
      : DEFAULT_ARMOR_SUPPLEMENTAL_B;
  // ADR 0048 — optional TB accessories (opt-in, template-gated).
  const tbAccessoryPlan = isTb ? tbAccessoryPlanForTemplate(tbTemplateId) : null;
  // Green Protocol also offers opt-in accessories (its book treats them as
  // optional). GP is periodised, so the cap is per strength session rather than
  // a single template — the offer itself is unconditional when GP is selected.
  // Neither Tactical Barbell nor Green Protocol auto-picks accessories any more:
  // the user adds them to a session themselves. The flag survives only so a block
  // deployed under the old behaviour keeps its accessory work when it is edited.
  const legacyAccessories =
    (isTb || isGp) && isEditing && (editContext?.accessoriesEnabled ?? false);
  const [accessoriesOn, setAccessoriesOn] = useState<boolean>(
    isEditing && editContext ? editContext.accessoriesEnabled : false,
  );
  // The muscle emphasis is no longer chosen in the wizard; a legacy block that
  // still auto-picks its accessories keeps the standard set when it is re-deployed.
  const accessoryMuscles = [...TB_DEFAULT_ACCESSORY_MUSCLES];
  const accessoryMovements = useMemo(
    () =>
      rehabMovements.filter((movement) => movement.pattern === ACCESSORY_PATTERN),
    [rehabMovements],
  );
  /**
   * Stated where the user is about to add work the book argues against, in the
   * place they'd add it — not as a block. Their session, their call (DC-K4).
   */
  const tbAccessoryCaution =
    isTb && tbAccessoryPlan == null
      ? tbTemplateId === "mass"
        ? "Mass already schedules its own arm and pull-up work."
        : "This template is built on heavy volume; extra work eats into it."
      : null;
  // Per-block two-a-day preference (migration 0110) — Hybrid only, default OFF.
  const [twoADay, setTwoADay] = useState<boolean>(false);
  const [customizeTb, setCustomizeTb] = useState<boolean>(
    Boolean(editContext?.customization),
  );
  const [customName, setCustomName] = useState<string>(
    editContext?.customization?.displayName ?? DEFAULT_CUSTOM_TB_NAME,
  );
  const [customSessionMovements, setCustomSessionMovements] = useState<
    Record<string, SeriesSlotDraft[]>
  >(() => {
    const customization = editContext?.customization;
    return customization && isTbCustomizationV1(customization)
      ? Object.fromEntries(
          Object.entries(customization.sessionMovements).map(
            ([key, movements]) => [
              key,
              movements.map((movement) => ({
                movement: movement.movement,
                ...(movement.sourceMovement
                  ? { sourceMovement: movement.sourceMovement }
                  : {}),
                ...(movement.kind ? { kind: movement.kind } : {}),
              })),
            ],
          ),
        )
      : {};
  });
  /**
   * Whether the user has changed any session's movements away from what the
   * template prescribes. Editing them writes the same overlay "Customize
   * template" does, so the overlay has to be sent for either reason.
   */
  const tbMovementsEdited = useMemo(() => {
    if (!isTb || isActivation || !activeTbTemplate) return false;
    return sessionSeriesFor(activeTbTemplate).some((series) => {
      const drafts = customSessionMovements[series.key];
      if (!drafts) return false;
      const canonical = slotDraftsFor(series);
      if (drafts.length !== canonical.length) return true;
      return drafts.some((draft, index) => {
        const base = canonical[index]!;
        return (
          draft.movement !== base.movement ||
          draft.sourceMovement !== base.sourceMovement ||
          draft.role != null
        );
      });
    });
  }, [isTb, isActivation, activeTbTemplate, customSessionMovements]);

  // User-authored superset / tri-set links, keyed by session series. Kept OUTSIDE
  // the TB customization blob so they also work on canonical templates and on
  // Activation — see lib/platform/session-links.
  const [sessionLinks, setSessionLinks] = useState<Record<string, SessionLink[]>>(    () => ({ ...(editContext?.sessionLinks?.bySeries ?? {}) }),
  );
  const setLinksForSeries = useCallback(
    (seriesKey: string, links: SessionLink[]) => {
      setSessionLinks((current) => {
        const next = { ...current };
        if (links.length > 0) next[seriesKey] = links;
        else delete next[seriesKey];
        return next;
      });
    },
    [],
  );
  const AB_TRIAD_LABEL = "AB Triad";

  /**
   * The lifts a slot can link, in session order.
   *
   * Movement keys are the CANONICAL slot identity the engine matches on
   * (`sourceMovement ?? movement`), so a link keeps working when the underlying
   * movement is substituted. The AB Triad is offered as ONE entry rather than
   * three: it is a single engine-owned circuit, so supersetting something "with
   * the AB Triad" means a four-station circuit, not picking its parts.
   *
   * A lift counts as MAIN unless it is a user-added accessory (`catalog:`) or
   * the template prescribes it as supplemental — Zulu's overhead press and
   * barbell row are template lifts but not main work, and warning about them
   * would make the main-lift warning meaningless.
   */
  const linkableMovementsFor = (
    drafts: readonly SeriesSlotDraft[],
    series?: NonNullable<PickerTbTemplate["sessionSeries"]>[number],
  ): LinkableMovement[] => {
    const triad = AB_TRIAD_MOVEMENTS as readonly string[];
    const identities = drafts.map(slotIdentity);
    const completeTriad = triad.every((m) => identities.includes(m));
    const out: LinkableMovement[] = [];
    let triadEmitted = false;
    for (const draft of drafts) {
      const key = slotIdentity(draft);
      if (completeTriad && triad.includes(key)) {
        if (triadEmitted) continue;
        triadEmitted = true;
        out.push({
          key: AB_TRIAD_GROUP_KEY,
          label: AB_TRIAD_LABEL,
          isMain: false,
          expandsTo: triad.map((movement) => ({
            key: movement,
            label: customMovementLabel(movement),
          })),
        });
        continue;
      }
      out.push({
        key,
        label: customMovementLabel(draft.movement),
        isMain:
          !draft.movement.startsWith("catalog:") &&
          (series ? slotOf(series, draft)?.role !== "supplemental" : true),
      });
    }
    return out;
  };
  // Rehab is no longer authored here. The wizard SELECTS from the Settings
  // library; these are the selected library ids, in display order.
  //
  // Seeded from whatever the program already has attached, so re-entering the
  // wizard on a live program shows its current rehab ticked. `attachProtocols`
  // then preserves each one's existing local id, which is what keeps its
  // supersets, day assignments and deleted-rehab tombstones matching.
  const [selectedProtocolIds, setSelectedProtocolIds] = useState<string[]>(() => {
    const bound = new Set(Object.keys(existingRehabBindings));
    return libraryProtocols
      .filter((protocol) => bound.has(protocol.id))
      .map((protocol) => protocol.id);
  });
  const libraryById = useMemo(
    () => new Map(libraryProtocols.map((protocol) => [protocol.id, protocol])),
    [libraryProtocols],
  );
  const attachedProtocols = useMemo(
    () =>
      attachProtocols(
        selectedProtocolIds.flatMap((id) => {
          const protocol = libraryById.get(id);
          return protocol
            ? [{ libraryId: protocol.id, name: protocol.name, items: protocol.items }]
            : [];
        }),
        existingRehabBindings,
      ),
    [existingRehabBindings, libraryById, selectedProtocolIds],
  );
  /** The customization's own view of the attached protocols. */
  const rehabProtocols = useMemo(
    () =>
      attachedProtocols.map((protocol) => ({
        id: protocol.localId,
        name: protocol.name,
        items: protocol.items as SerializedRehabItem[],
      })),
    [attachedProtocols],
  );
  const toggleProtocol = useCallback((libraryId: string) => {
    setSelectedProtocolIds((current) =>
      current.includes(libraryId)
        ? current.filter((id) => id !== libraryId)
        : [...current, libraryId],
    );
  }, []);
  const [activationDrafts, setActivationDrafts] =
    useState<ActivationDrafts>(() =>
      activationDraftsFromCustomization(
        activeTbTemplate,
        editContext?.customization,
        armorSupplementalA,
        armorSupplementalB,
      ),
    );

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
    setCustomizeTb(false);
    setCustomName(DEFAULT_CUSTOM_TB_NAME);
    setCustomSessionMovements(
      activeTbTemplate
        ? Object.fromEntries(
            sessionSeriesFor(activeTbTemplate).map((series) => [
              series.key,
              slotDraftsFor(series),
            ]),
          )
        : {},
    );
    setSelectedProtocolIds([]);
    setCatalogMovementMeta({});
    setActivationDrafts(
      defaultActivationDrafts(
        activeTbTemplate,
        armorSupplementalA,
        armorSupplementalB,
      ),
    );
  }

  const fixedSchedule = !!selected?.fixedSchedule || !!activeTbTemplate?.fixedSchedule;
  // Strength-only programs (5/3/1, TB) let the user add OPEN cardio days; the
  // concurrent programs (Hybrid, Green Protocol) own their own cardio.
  const supportsCardioDays = selected?.id === "wendler-531" || isTb;


  // The program dictates how many strength days a week it needs. TB's active
  // TEMPLATE owns the frequency; 5/3/1 lets the user choose it; fixed-schedule
  // programs (Green Protocol) prescribe their own calendar; Hybrid and HYROX are
  // open (any training-day count, derived from the Schedule step).
  const requiredDays: number | null = fixedSchedule
    ? null
    : isTb
      ? activeTbTemplate?.sessionsPerWeek ?? null
      : selected?.id === "wendler-531"
        ? freq531
        : isHyrox
          ? null
          : selected?.sessionsPerWeek ?? null;

  const weekdays = useMemo(
    () => week.flatMap((t, i) => (t === "strength" ? [i] : [])),
    [week],
  );
  const cardioWeekdays = useMemo(
    () => week.flatMap((t, i) => (t === "cardio" ? [i] : [])),
    [week],
  );
  const rehabWeekdays = useMemo(
    () => week.flatMap((t, i) => (t === "rehab" ? [i] : [])),
    [week],
  );
  const dayCounts = useMemo(() => {
    const c = { strength: 0, cardio: 0, rehab: 0, rest: 0 };
    for (const t of week) c[t] += 1;
    return c;
  }, [week]);
  // HYROX is frequency-flexible but the engine needs at least 3 training days
  // (its clamp floor) and at most 7 (one per weekday). Enforce that range so we
  // never deploy a schedule the engine would under/over-seat.
  const HYROX_MIN_DAYS = 3;
  const HYROX_MAX_DAYS = 7;
  const hyroxDaysOk =
    !isHyrox || (weekdays.length >= HYROX_MIN_DAYS && weekdays.length <= HYROX_MAX_DAYS);
  const daysMatch =
    (fixedSchedule || requiredDays == null || weekdays.length === requiredDays) && hyroxDaysOk;
  // The scheduled days of a mixed-modality program (HYROX, Green Protocol) are a
  // MIX of runs / stations / strength — not "strength days". Use a neutral noun
  // so the review/summary copy isn't misleading (field report).
  const daysNoun = fixedSchedule || isHyrox ? "training" : "strength";
  // Title-cased version for the day-cell label + legend chip ("Training" / "Strength").
  const daysNounCap = daysNoun.charAt(0).toUpperCase() + daysNoun.slice(1);

  const clusterValidation = useMemo<ClusterValidationLite | null>(() => {
    if (!activeTbTemplate) return null;
    return validateClusterClient(activeTbTemplate, cluster);
  }, [activeTbTemplate, cluster]);
  const clusterOk = !activeTbTemplate || (clusterValidation?.ok ?? false);
  const selectedStartSchedule = startScheduleFor(
    activeTbTemplate,
    startWeekIndex,
  );

  // Cluster editing (TB). The mockup edits the cluster inline on the benchmarks
  // step: add/remove a lift, and (for split templates) move a lift between the A
  // and B sessions. Editable only when the template allows a variable lift count.
  const clusterEditable =
    !!activeTbTemplate &&
    !activeTbTemplate.fixedLoadout &&
    activeTbTemplate.clusterMin !== activeTbTemplate.clusterMax;
  const countingLifts = clusterValidation?.countingLifts ?? cluster.length;
  const canAddCluster =
    clusterEditable &&
    countingLifts < (activeTbTemplate?.clusterMax ?? 0) &&
    benchRoles.some((r) => !cluster.some((c) => c.movement === r.engineKey));

  function canRemoveCluster(movement: string): boolean {
    if (!activeTbTemplate || !clusterEditable) return false;
    const entry = cluster.find((c) => c.movement === movement);
    if (!entry) return false;
    if (entry.kind === "bodyweight") return true;
    return countingLifts - 1 >= activeTbTemplate.clusterMin;
  }
  function removeClusterLift(movement: string) {
    setCluster(cluster.filter((c) => c.movement !== movement));
  }
  function cycleClusterSplit(movement: string) {
    setCluster(
      cluster.map((c) =>
        c.movement === movement ? { ...c, split: c.split === "A" ? "B" : "A" } : c,
      ),
    );
  }
  function addClusterLift() {
    if (!activeTbTemplate || countingLifts >= activeTbTemplate.clusterMax) return;
    const used = new Set(cluster.map((c) => c.movement));
    const next = benchRoles.map((r) => r.engineKey).find((k) => !used.has(k));
    if (!next) return;
    if (activeTbTemplate.structure === "split") {
      const a = cluster.filter((c) => c.split === "A").length;
      const b = cluster.filter((c) => c.split === "B").length;
      setCluster([...cluster, { movement: next, split: a <= b ? "A" : "B" }]);
    } else {
      setCluster([...cluster, { movement: next }]);
    }
  }

  // Operator's optional bodyweight pull-up: a 4th lift exempt from the barbell
  // cap, prescribed off max reps. Only offered when the template + a resolvable
  // catalog movement both allow it.
  const bodyweightEntry = cluster.find((c) => c.kind === "bodyweight");
  const canAddBodyweight =
    !!activeTbTemplate && !!activeTbTemplate.allowsBodyweightFourth && !!pullupMovement && !bodyweightEntry;
  function addBodyweightLift() {
    if (!canAddBodyweight) return;
    const split =
      activeTbTemplate!.structure === "split"
        ? cluster.filter((c) => c.split === "A").length <= cluster.filter((c) => c.split === "B").length
          ? "A"
          : "B"
        : undefined;
    setCluster([...cluster, { movement: "pullup", kind: "bodyweight", ...(split ? { split } : {}) }]);
  }
  function setPullupRepsValue(v: string) {
    setPullupReps(v);
  }

  // Which main-lift roles the Benchmarks step shows. Cluster programs (TB) show
  // the barbell lifts in their chosen cluster; everyone else shows all four mains.
  const relevantBenchKeys = useMemo<string[]>(() => {
    if (customizeTb && activeTbTemplate && isActivation) {
      const roleKeys = benchRoles.map((role) => role.engineKey);
      const available = new Set(roleKeys);
      const phaseEnds: Record<ActivationPhaseKey, number> = {
        base: 3,
        armor: 7,
        operator: 18,
        vertex: 23,
      };
      return (activeTbTemplate.activationPhases ?? [])
        .filter((phase) => phaseEnds[phase.key] >= startWeekIndex)
        .flatMap((phase) =>
          Object.values(activationDrafts[phase.key].sessions),
        )
        .flatMap((session) => Object.values(session.movements))
        .filter((key): key is string => key != null)
        .filter(
          (key) =>
            available.has(key) &&
            activationMovementKindByKey.get(key) !== "unanchored" &&
            activationMovementKindByKey.get(key) !== "bodyweight",
        )
        .filter((key, index, all) => all.indexOf(key) === index)
        .sort((a, b) => roleKeys.indexOf(a) - roleKeys.indexOf(b));
    }
    if (customizeTb && activeTbTemplate) {
      const roleKeys = benchRoles.map((role) => role.engineKey);
      const available = new Set(roleKeys);
      return Object.values(customSessionMovements)
        .flat()
        .map((draft) => draft.movement)
        .filter((key) => available.has(key) && key !== "pullup")
        .filter((key, index, all) => all.indexOf(key) === index)
        .sort((a, b) => roleKeys.indexOf(a) - roleKeys.indexOf(b));
    }
    const base = relevantBenchmarkKeysFor(activeTbTemplate, cluster, benchRoles);
    return base;
  }, [
    activeTbTemplate,
    benchRoles,
    cluster,
    isActivation,
    customizeTb,
    customSessionMovements,
    activationDrafts,
    activationMovementKindByKey,
    startWeekIndex,
  ]);

  const enteredAnyTm = useMemo(
    () => Object.values(benchVals).some((b) => Number(b.valueStr) > 0),
    [benchVals],
  );
  const hasUsableTms = anchoredKeys.length > 0 || enteredAnyTm;
  const missingRelevantBenchKeys = relevantBenchKeys.filter(
    (key) => Number(benchVals[key]?.valueStr ?? 0) <= 0,
  );
  const benchmarksReady =
    (isActivation && (!customizeTb || startWeekIndex <= 4)) ||
    (activeTbTemplate?.fixedLoadout
      ? missingRelevantBenchKeys.length === 0
      : hasUsableTms);
  const activationStartRequiredBenchKeys = isActivation
    ? activationRequiredBenchmarkKeysFor(startWeekIndex)
    : [];
  const missingActivationStartBenchKeys =
    activationStartRequiredBenchKeys.filter(
      (key) => Number(benchVals[key]?.valueStr ?? 0) <= 0,
    );
  const activationStartBenchmarksReady =
    !isActivation ||
    customizeTb ||
    missingActivationStartBenchKeys.length === 0;
  const activationDraftsReady = useMemo(() => {
    if (!customizeTb || !isActivation) return true;
    for (const phase of activeTbTemplate?.activationPhases ?? []) {
      const occupied = new Set<number>();
      for (const session of phase.sessions) {
        const draft = activationDrafts[phase.key].sessions[session.key];
        if (!draft) return false;
        if (session.type === "strength" && !draft.enabled) return false;
        if (draft.enabled) {
          if (occupied.has(draft.day)) return false;
          occupied.add(draft.day);
        }
        if (
          session.type === "strength" &&
          Object.values(draft.movements).every(
            (movement) => movement == null,
          )
        ) {
          return false;
        }
        const selected = Object.values(draft.movements).filter(
          (movement): movement is string => movement != null,
        );
        if (new Set(selected).size !== selected.length) return false;
      }
    }
    // Library protocols are validated where they're authored (Settings) and by
    // the database, so the wizard only checks that a selection resolves.
    const protocolsReady = rehabProtocols.every(
      (protocol) => protocol.name.trim().length > 0 && protocol.items.length > 0,
    );
    // Assignments are deliberately NOT gated here. One naming a protocol that
    // isn't attached is dropped when the payload is built (`pruneAssignments`),
    // and its day already renders as "No rehab" — so rejecting it contradicted
    // both the screen and the payload, and stranded the wizard: the only way
    // out was to re-pick "No rehab" on every stale day, which deleted the entry
    // that should never have blocked the save.
    return protocolsReady;
  }, [
    activeTbTemplate,
    activationDrafts,
    customizeTb,
    isActivation,
    rehabProtocols,
  ]);

  const canDeploy =
    !!selected?.enabled &&
    (fixedSchedule || weekdays.length > 0) &&
    daysMatch &&
    benchmarksReady &&
    activationStartBenchmarksReady &&
    activationDraftsReady &&
    clusterOk &&
    (!isTb ||
      isActivation ||
      !activeTbTemplate ||
      sessionSeriesFor(activeTbTemplate).every(
        (series) => draftsForSeries(series).length > 0,
      )) &&
    (!customizeTb ||
      (customName.trim().length > 0 &&
        (rehabWeekdays.length === 0 || rehabProtocols.length > 0))) &&
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
    const changed = p.id !== selectedId;
    setSelectedId(p.id);
    const defaults = defaultValuesFor(p.fields);
    setValues(defaults);
    setResult(null);
    setEstimate(null);
    setBenchVals(initBenchVals(unit));
    setBenchTouched(new Set());
    // Picking a different program invalidates the downstream steps — re-walk them.
    if (changed) setMaxStep(0);

    if (p.id === TB_PROGRAM_ID) {
      const t = tbTemplateById.get(String(defaults.templateId ?? ""));
      setCluster(t ? defaultClusterFor(t, anchoredKeys) : []);
      setLastTbTemplateId(String(defaults.templateId ?? "") || null);
      setWeek(buildWeek(t?.sessionsPerWeek ?? p.sessionsPerWeek ?? 3));
      setCustomizeTb(false);
      setCustomName(DEFAULT_CUSTOM_TB_NAME);
      setCustomSessionMovements(
        t
          ? Object.fromEntries(
              sessionSeriesFor(t).map((series) => [
                series.key,
                slotDraftsFor(series),
              ]),
            )
          : {},
      );
      setSelectedProtocolIds([]);
      setCatalogMovementMeta({});
      setActivationDrafts(defaultActivationDrafts(t ?? null));
    } else {
      setCluster([]);
      setLastTbTemplateId(null);
      setWeek(buildWeek(p.sessionsPerWeek ?? 4));
      setSelectedProtocolIds([]);
      setCatalogMovementMeta({});
      setActivationDrafts(defaultActivationDrafts(null));
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
      // Strength-only programs cycle Strength → Cardio → Rest; others toggle
      // Strength ↔ Rest (cardio is engine-owned, not a wizard choice).
      const next: DayType = supportsCardioDays
        ? cur === "strength"
          ? "cardio"
          : cur === "cardio"
            ? customizeTb
              ? "rehab"
              : "rest"
            : cur === "rehab"
              ? "rest"
            : "strength"
        : cur === "strength"
          ? "rest"
          : "strength";
      const w = [...prev];
      w[i] = next;
      return w;
    });
  }

  function toggleCustomizeTb() {
    if (!activeTbTemplate) return;
    setCustomizeTb((current) => {
      const next = !current;
      if (next && Object.keys(customSessionMovements).length === 0) {
        setCustomSessionMovements(
          Object.fromEntries(
            sessionSeriesFor(activeTbTemplate).map((series) => [
              series.key,
              slotDraftsFor(series),
            ]),
          ),
        );
      }
      if (next && isActivation) {
        setActivationDrafts(
          activationDraftsFromCustomization(
            activeTbTemplate,
            editContext?.customization,
            armorSupplementalA,
            armorSupplementalB,
          ),
        );
      }
      if (!next) {
        setWeek((currentWeek) =>
          currentWeek.map((day) => (day === "rehab" ? "rest" : day)),
        );
      }
      return next;
    });
  }

  function patchActivationSession(
    phase: ActivationPhaseKey,
    sessionKey: string,
    patch: Partial<ActivationSessionDraft>,
  ) {
    setActivationDrafts((current) => ({
      ...current,
      [phase]: {
        ...current[phase],
        sessions: {
          ...current[phase].sessions,
          [sessionKey]: {
            ...current[phase].sessions[sessionKey]!,
            ...patch,
          },
        },
      },
    }));
  }

  function moveActivationSession(
    phase: ActivationPhaseKey,
    sessionKey: string,
    targetDay: number,
  ) {
    setActivationDrafts((current) => {
      const phaseDraft = current[phase];
      const moving = phaseDraft.sessions[sessionKey];
      if (!moving || moving.day === targetDay) return current;
      const occupant = moving.enabled
        ? Object.entries(phaseDraft.sessions).find(
            ([key, session]) =>
              key !== sessionKey &&
              session.enabled &&
              session.day === targetDay,
          )
        : undefined;
      const sessions = {
        ...phaseDraft.sessions,
        [sessionKey]: { ...moving, day: targetDay },
      };
      if (occupant) {
        const [occupantKey, occupantSession] = occupant;
        sessions[occupantKey] = {
          ...occupantSession,
          day: moving.day,
        };
      }
      return {
        ...current,
        [phase]: {
          ...phaseDraft,
          sessions,
        },
      };
    });
  }

  function setActivationMovement(
    phase: ActivationPhaseKey,
    sessionKey: string,
    sourceMovement: string,
    movement: string | null,
  ) {
    setActivationDrafts((current) => ({
      ...current,
      [phase]: {
        ...current[phase],
        sessions: {
          ...current[phase].sessions,
          [sessionKey]: {
            ...current[phase].sessions[sessionKey]!,
            movements: {
              ...current[phase].sessions[sessionKey]!.movements,
              [sourceMovement]: movement,
            },
          },
        },
      },
    }));
    // Removing the slot must also take it out of any link, or the link keeps a
    // member the session no longer has and the engine drops the whole thing at
    // materialisation. Replacing the exercise is fine: links are keyed by the
    // canonical slot, so they survive a swap.
    if (movement == null) {
      setSessionLinks((current) => {
        const links = current[sessionKey];
        if (!links?.length) return current;
        const pruned = pruneMovementFromLinks(links, sourceMovement);
        if (
          pruned.length === links.length &&
          pruned.every(
            (l, i) => l.members.length === links[i]!.members.length,
          )
        ) {
          return current;
        }
        const next = { ...current };
        if (pruned.length > 0) next[sessionKey] = pruned;
        else delete next[sessionKey];
        return next;
      });
    }
  }

  function setActivationMovements(
    phase: ActivationPhaseKey,
    sessionKey: string,
    movements: Readonly<Record<string, string | null>>,
  ) {
    setActivationDrafts((current) => ({
      ...current,
      [phase]: {
        ...current[phase],
        sessions: {
          ...current[phase].sessions,
          [sessionKey]: {
            ...current[phase].sessions[sessionKey]!,
            movements: {
              ...current[phase].sessions[sessionKey]!.movements,
              ...movements,
            },
          },
        },
      },
    }));
  }

  function setActivationRehabProtocol(
    phase: ActivationPhaseKey,
    day: number,
    protocolId: string,
  ) {
    setActivationDrafts((current) => {
      const rehabAssignments = {
        ...current[phase].rehabAssignments,
      };
      if (protocolId) rehabAssignments[day] = protocolId;
      else delete rehabAssignments[day];
      return {
        ...current,
        [phase]: {
          ...current[phase],
          rehabAssignments,
        },
      };
    });
  }

  /** Drop a row from a customized slot list, keyed by the slot it fills. */
  function removeSeriesMovement(seriesKey: string, identity: string) {
    setCustomSessionMovements((current) => {
      const selected = current[seriesKey] ?? [];
      return {
        ...current,
        [seriesKey]: selected.filter((draft) => slotIdentity(draft) !== identity),
      };
    });
    // A removed lift must leave any link it was part of, or the link keeps a
    // member the session no longer has: the engine requires every member to be
    // present, so it would drop the whole link at materialisation and the
    // superset would silently disappear.
    setSessionLinks((current) => {
      const links = current[seriesKey];
      if (!links?.length) return current;
      const pruned = pruneMovementFromLinks(links, identity);
      if (pruned.length === links.length &&
          pruned.every((l, i) => l.members.length === links[i]!.members.length)) {
        return current;
      }
      const next = { ...current };
      if (pruned.length > 0) next[seriesKey] = pruned;
      else delete next[seriesKey];
      return next;
    });
  }

  /**
   * Put a different exercise in a slot. The slot itself is untouched, so links
   * keyed by it survive and the engine keeps prescribing it the same way.
   */
  function replaceSeriesMovement(
    seriesKey: string,
    identity: string,
    movement: string,
    kind?: "barbell" | "weighted-bw" | "bodyweight" | "unanchored",
  ) {
    setCustomSessionMovements((current) => {
      const selected = current[seriesKey] ?? [];
      return {
        ...current,
        [seriesKey]: selected.map((draft) =>
          slotIdentity(draft) === identity
            ? {
                sourceMovement: identity,
                movement,
                ...(kind ? { kind } : {}),
              }
            : draft,
        ),
      };
    });
  }

  /** Add a movement the user chose themselves; it is prescribed as accessory work. */
  function addSeriesAccessory(seriesKey: string, movement: string) {
    setCustomSessionMovements((current) => {
      const selected =
        current[seriesKey] ??
        (activeTbTemplate
          ? slotDraftsFor(
              sessionSeriesFor(activeTbTemplate).find(
                (entry) => entry.key === seriesKey,
              )!,
            )
          : []);
      if (selected.some((draft) => draft.movement === movement)) return current;
      return {
        ...current,
        [seriesKey]: [...selected, { movement, role: "accessory" as const }],
      };
    });
  }

  /** Drop several rows at once — the AB Triad is removed whole or not at all. */
  function removeSeriesMovements(
    seriesKey: string,
    identities: readonly string[],
  ) {
    for (const identity of identities) removeSeriesMovement(seriesKey, identity);
  }

  /** The rows for a session: the user's edits, or the template's own slots. */
  function draftsForSeries(
    series: NonNullable<PickerTbTemplate["sessionSeries"]>[number],
  ): SeriesSlotDraft[] {
    return customSessionMovements[series.key] ?? slotDraftsFor(series);
  }

  /**
   * Prescribed lifts the user has dropped from a slot list. Removal is allowed —
   * it is their session — but it is stated back to them rather than passing
   * silently (DC-K4).
   */
  function removedSupplementalLabels(
    series: NonNullable<PickerTbTemplate["sessionSeries"]>[number],
  ): string[] {
    const kept = new Set(draftsForSeries(series).map(slotIdentity));
    return series.slots
      .filter((slot) => !kept.has(slot.sourceMovement))
      .map((slot) => customMovementLabel(slot.sourceMovement));
  }

  function resetWeek() {
    setWeek(buildWeek(requiredDays ?? freq531));
  }
  function bumpFreq(delta: number) {
    if (selected?.id !== "wendler-531") return;
    // 5/3/1 has 4 main lifts; only frequencies that split them evenly are
    // offered: 4 (one lift/day) or 2 (two lifts/day).
    const ALLOWED = [2, 4];
    const curIdx = ALLOWED.indexOf(freq531);
    const baseIdx = curIdx === -1 ? ALLOWED.length - 1 : curIdx;
    const nextIdx = Math.max(0, Math.min(ALLOWED.length - 1, baseIdx + (delta > 0 ? 1 : -1)));
    const next = ALLOWED[nextIdx]!;
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
    if (isActivation) {
      setupValues.armorSupplementalA = armorSupplementalA;
      setupValues.armorSupplementalB = armorSupplementalB;
    }
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

    // 5/3/1 two-day lift pairing → the engine's day order (chunked into pairs).
    // Only meaningful at 2 days/week; the engine ignores it at 4 (one lift/day).
    if (selected.id === "wendler-531" && freq531 === 2) {
      const chosen = PAIRINGS.find((p) => p.id === pairing) ?? PAIRINGS[0]!;
      setupValues.dayOrder = chosen.dayOrder;
    }

    // The weekly blob stores ONE unnamed item list; the selector is a single
    // choice there, so the first (only) attached protocol supplies it.
    const rehabItems = rehabProtocols[0]?.items ?? [];
    const activationPhasePayload = (
      phase: ActivationPhaseKey,
    ): TbActivationCustomizationV3["phases"][ActivationPhaseKey] => {
      const sessions: TbActivationCustomizationV3["phases"][ActivationPhaseKey]["sessions"] =
        Object.fromEntries(
        (activeTbTemplate?.activationPhases ?? [])
          .find((candidate) => candidate.key === phase)
          ?.sessions.map((session) => {
            const draft = activationDrafts[phase].sessions[session.key]!;
            const movementOverrides: TbActivationCustomizationV3["phases"][ActivationPhaseKey]["sessions"][string]["movementOverrides"] =
              {};
            for (const [sourceMovement, movement] of Object.entries(
              draft.movements,
            )) {
              if (movement === sourceMovement) continue;
              if (movement == null) {
                movementOverrides[sourceMovement] = null;
                continue;
              }
              const kind = activationMovementKindByKey.get(movement);
              const catalog = catalogMovementMeta[movement];
              movementOverrides[sourceMovement] = {
                movement,
                ...(catalog
                  ? {
                      movementId: catalog.id,
                      slug: catalog.slug,
                      displayName: catalog.name,
                    }
                  : {}),
                ...(kind ? { kind } : {}),
              };
            }
            return [
              session.key,
              {
                day: draft.day,
                enabled: draft.enabled,
                movementOverrides,
              },
            ];
          }) ?? [],
        );
      return {
        sessions,
        // A day pointing at a protocol the user has since unticked would make
        // the whole customization invalid — it cross-validates that every
        // assignment names an attached protocol.
        rehabAssignments: pruneAssignments(
          Object.entries(activationDrafts[phase].rehabAssignments)
            .map(([day, protocolId]) => ({
              day: Number(day),
              protocolId,
            }))
            .sort((left, right) => left.day - right.day),
          attachedProtocols,
        ),
      };
    };
    const customization: TbCustomization | undefined =
      (customizeTb || tbMovementsEdited) && activeTbTemplate
        ? isActivation
          ? customizeTb
            ? {
                version: TB_ACTIVATION_CUSTOMIZATION_VERSION,
                templateId: "activation",
                displayName: customName.trim(),
                phases: {
                  base: activationPhasePayload("base"),
                  armor: activationPhasePayload("armor"),
                  operator: activationPhasePayload("operator"),
                  vertex: activationPhasePayload("vertex"),
                },
                rehabProtocols: rehabProtocols.map((protocol) => ({
                  id: protocol.id,
                  name: protocol.name.trim(),
                  items: protocol.items,
                })),
              }
            : undefined
          : {
              version: TB_CUSTOMIZATION_VERSION,
              // Only the "Customize template" flow names a block. Editing the
              // movements in a session writes this same overlay, and that alone
              // must not rename the user's program.
              ...(customizeTb ? { displayName: customName.trim() } : {}),
              dayTypes: week.map((day) =>
                day === "cardio" ? "conditioning" : day,
              ),
              sessionMovements: Object.fromEntries(
                sessionSeriesFor(activeTbTemplate).map((series) => [
                  series.key,
                  draftsForSeries(series).map((draft) => {
                    const slot = slotOf(series, draft);
                    const kind =
                      draft.kind ??
                      slot?.kind ??
                      (draft.movement === "weighted-pullup"
                        ? "weighted-bw"
                        : draft.movement === "pullup"
                          ? "bodyweight"
                          : undefined);
                    const catalog = catalogMovementMeta[draft.movement];
                    return {
                      movement: draft.movement,
                      // A row either fills a slot the template prescribes, or is
                      // accessory work the user added. Never both, never neither.
                      ...(slot
                        ? { sourceMovement: slot.sourceMovement }
                        : { role: "accessory" as const }),
                      ...(catalog
                        ? {
                            movementId: catalog.id,
                            slug: catalog.slug,
                            displayName: catalog.name,
                          }
                        : {}),
                      ...(kind ? { kind } : {}),
                    };
                  }),
                ]),
              ),
              ...(customizeTb && rehabWeekdays.length > 0
                ? { rehab: { items: rehabItems } }
                : {}),
            }
        : undefined;

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

    // Operator's optional bodyweight pull-up: persist its max-reps as the pullup
    // anchor (stored in the 1RM column; the engine reads bodyweight anchors as
    // max reps). The anchor MUST exist for the engine to prescribe the lift, so
    // we write it whenever the cluster carries a pull-up — not only when touched.
    if (bodyweightEntry && pullupMovement) {
      const reps = Math.round(Number(pullupReps));
      if (Number.isFinite(reps) && reps > 0) {
        saves.push({ movementId: pullupMovement.movementId, oneRmKg: reps, label: "Pull-ups" });
      }
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
      // Rehab supersets belong to the PROTOCOL now, so they come from the
      // library rather than wizard state. Any leftover `rehab.*` entry for a
      // protocol that is no longer attached is dropped — deploy rejects a link
      // naming a protocol that doesn't exist, and a reused id would otherwise
      // adopt it.
      const rehabLinkEntries = attachedProtocols.flatMap((protocol) => {
        const links = libraryById.get(protocol.libraryId)?.links ?? [];
        return links.length > 0
          ? ([[`rehab.${protocol.localId}`, links]] as const)
          : [];
      });
      const outgoingLinks = {
        ...pruneRehabLinks(sessionLinks, attachedProtocols),
        ...Object.fromEntries(rehabLinkEntries),
      };
      const res = await createProgramInstance({
        programId: selected.id,
        setupValues,
        weekdays,
        startedOn,
        ...(supportsCardioDays && cardioWeekdays.length > 0 ? { cardioWeekdays } : {}),
        ...(selected.id === "hyrox" && raceDate ? { raceDate } : {}),
        ...(startWeekIndex > 0 ? { startWeekIndex } : {}),
        ...(legacyAccessories && accessoriesOn
          ? { accessories: { enabled: true, muscles: accessoryMuscles } }
          : {}),        ...((isHybrid || isHyrox) && twoADay ? { twoADay: true } : {}),
        ...(isTb && Object.keys(outgoingLinks).length > 0
          ? {
              sessionLinks: {
                version: SESSION_LINKS_VERSION as 1,
                bySeries: outgoingLinks,
              },
            }
          : {}),
        ...(customization ? { customization } : {}),
        ...(isEditing && editContext ? { editBlockId: editContext.blockId } : {}),
        ...(!isEditing && seasonBlockId ? { seasonBlockId } : {}),
        ...(isTb && attachedProtocols.length > 0
          ? {
              rehabBindings: attachedProtocols.map((protocol) => ({
                localProtocolId: protocol.localId,
                rehabProtocolId: protocol.libraryId,
              })),
            }
          : {}),
      });
      setResult(res);
      if (res.ok) {
        router.push(
          isEditing
            ? res.todayLeftAsIs
              ? "/app/plan?kept=today"
              : "/app/plan"
            : "/app",
        );
      }
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

  // In edit mode the program is locked, so the wizard floor is the Loadout step.
  const minStep = isEditing ? 1 : 0;

  function goBack() {
    setStep((s) => Math.max(minStep, s - 1));
  }
  function goNext() {
    setStep((s) => {
      const next = Math.min(3, s + 1);
      setMaxStep((m) => Math.max(m, next));
      return next;
    });
  }
  /** Jump straight to an already-visited step via the progress rail. */
  function goToStep(i: number) {
    if (i < minStep) return;
    if (i <= maxStep && i !== step) setStep(i);
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
              const leftIndex = CARD_ORDER.indexOf(a.id);
              const bi = CARD_ORDER.indexOf(b.id);
              return (
                (leftIndex === -1 ? 99 : leftIndex) - (bi === -1 ? 99 : bi)
              );
            })
            .map((p) => {
            const meta = CARD_META[p.id] ?? { kick: "", code: p.name };
            const wrap = meta.code.includes(" ");
            const codeCls = `${styles.code}${wrap ? ` ${styles.codeWrap}` : ""}`;
            const codeStyle = !wrap && meta.code.length > 4 ? { fontSize: 20 } : undefined;
            const tagline = CARD_TAGLINE[p.id] ?? p.summary;
            const isSel = p.id === selectedId;
            return (
              <div key={p.id} style={{ position: "relative", width: "100%" }}>
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
        </div>
      </div>
    );
  }

  function renderLoadoutOptions() {
    if (!selected || !loadoutKey) return null;
    const copy = TEMPLATE_COPY[selected.id] ?? {};
    if (loadoutMeta?.grouped) {
      // Green Protocol — grouped into Foundation / Continuation sections.
      // Order Foundation first (by sequence), then Continuation, so the section
      // headers render once each and match the mockup (the engine's option order
      // isn't grouped). JS sort is stable, so ties keep the engine order.
      const GROUP_RANK: Record<string, number> = { foundation: 0, continuation: 1 };
      const orderedOptions = [...loadoutOptions].sort((a, b) => {
        const ca = copy[a.value];
        const cb = copy[b.value];
        const ga = GROUP_RANK[ca?.group ?? "continuation"] ?? 1;
        const gb = GROUP_RANK[cb?.group ?? "continuation"] ?? 1;
        if (ga !== gb) return ga - gb;
        return (ca?.seq ?? 99) - (cb?.seq ?? 99);
      });
      let lastGroup: string | null = null;
      return (
        <div className={`${styles.opts} ${styles.optsGrouped}`}>
          {orderedOptions.map((o) => {
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
        {selected.id === "wendler-531" && (
          <div className={`${styles.opt} ${styles.optLocked}`} aria-disabled="true">
            <div className={styles.optOn}>
              <span className={styles.optNm}>Krypteia</span>
              <span className={styles.pill}>Coming soon</span>
            </div>
            <div className={styles.optDesc}>
              Advanced leader/anchor with jumps, throws and a tight accessory cap.
            </div>
          </div>
        )}
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
        : isHyrox && weekdays.length > 0
          ? `${weekdays.length} / WEEK`
          : "\u2014";
    const lenText = loadoutMeta.freqChoice
      ? (loadoutMeta.lenNote ?? "\u2014").toUpperCase()
      : (copy?.len ?? "\u2014").toUpperCase();
    return (
      <div className={styles.specwrap}>
        <div className={styles.label}>{selected?.id === "wendler-531" ? "Your cycle" : "Your block"}</div>
        <div className={styles.spec}>
          <div className={styles.cell}>
            <div className={styles.cl}>Frequency</div>
            <div className={styles.cv}>
              {loadoutMeta.freqChoice ? `${freq531} / WEEK` : freqText}
            </div>
          </div>
          <div className={styles.cell}>
            <div className={styles.cl}>Length</div>
            <div className={styles.cv}>{lenText}</div>
          </div>
          <div className={`${styles.cell} ${styles.wide}`}>
            <div className={styles.cl}>
              {loadoutMeta.structLabel}
              {selected.id === "wendler-531" && (
                <button
                  type="button"
                  className={styles.clInfo}
                  aria-label="What do Leader, 7th week and Anchor mean?"
                  onClick={() =>
                    setModalInfo({
                      kick: "Wendler 5/3/1",
                      title: "How a 5/3/1 cycle is built",
                      body:
                        "A 5/3/1 cycle is made of short blocks that each do a different job. You run a couple of Leaders, take a lighter 7th week, then finish with an Anchor.\n\nLEADER \u2014 the volume-building blocks. You train at submaximal weights with extra supplemental sets to bank work and drive size, without grinding. You typically run two Leaders back to back.\n\n7TH WEEK \u2014 a single lighter week between phases. It either deloads you (easy, to recover) or tests your training max so the app knows whether to nudge your numbers up. It\u2019s the built-in checkpoint that keeps your numbers on track.\n\nANCHOR \u2014 the block where you express the strength you built. Volume drops, intensity rises, and you push your top sets for new rep records. One Anchor caps the cycle before you start the next.",
                      meta: ["2\u00D7 Leader", "7th week", "1\u00D7 Anchor"],
                    })
                  }
                >
                  i
                </button>
              )}
            </div>
            <div className={`${styles.cv} ${styles.cvSm}`}>{loadoutMeta.struct}</div>
          </div>
        </div>
      </div>
    );
  }

  /**
   * The sessions this template runs, and the movements in each. Read from the
   * template rather than written out in prose, so it stays true as templates
   * change — and editable in place, so there is one surface for shaping a
   * session rather than a preview here and a builder three steps later.
   */
  function renderTbSessionPreview() {
    if (!isTb || isActivation || !activeTbTemplate) return null;
    const series = sessionSeriesFor(activeTbTemplate);
    if (series.length === 0) return null;
    const triad = AB_TRIAD_MOVEMENTS as readonly string[];
    return (
      <div className={styles.specwrap} data-testid="tb-session-preview">
        <div className={styles.label}>Each session</div>
        <div className={styles.seriesGrid}>
          {series.map((entry) => {
            const drafts = draftsForSeries(entry);
            const linkable = linkableMovementsFor(drafts, entry);
            const links = sessionLinks[entry.key] ?? [];
            const linkBadges = slotLinkBadges(links, linkable);
            // The AB Triad is one circuit. It is offered as a single row so it
            // can't be half-removed, which would leave the rest running loose.
            const wholeTriad = triad.every((movement) =>
              drafts.some((draft) => slotIdentity(draft) === movement),
            );
            const removed = removedSupplementalLabels(entry);
            let triadShown = false;
            return (
              <section key={entry.key} className={styles.seriesCard}>
                <header>
                  <b>{entry.label}</b>
                </header>
                <div className={styles.seriesExercises}>
                  {drafts.map((draft) => {
                    const identity = slotIdentity(draft);
                    const slot = slotOf(entry, draft);
                    const isTriad = wholeTriad && triad.includes(identity);
                    if (isTriad && triadShown) return null;
                    if (isTriad) triadShown = true;
                    const badge = linkBadges.get(identity);
                    const roleLabel =
                      draft.role === "accessory"
                        ? "Accessory"
                        : slot?.role === "supplemental"
                          ? "Supplemental"
                          : "Main lift";
                    return (
                      <div
                        key={identity}
                        className={rowLinkClass(styles, badge, "")}
                        data-testid={`tb-slot-${entry.key}-${isTriad ? "ab-triad" : identity}`}
                      >
                        <span>
                          <LinkBadge
                            styles={styles}
                            badge={badge}
                            links={links}
                            movements={linkable}
                            seriesKey={entry.key}
                            onChange={setLinksForSeries}
                          />
                          <b>
                            {isTriad
                              ? AB_TRIAD_LABEL
                              : customMovementLabel(draft.movement)}
                          </b>
                          <small>{isTriad ? "Supplemental" : roleLabel}</small>
                        </span>
                        <span className={styles.seriesRowActions}>
                          {slot && !isTriad ? (
                            <details className={styles.addExercise}>
                              <summary
                                data-testid={`tb-slot-change-${entry.key}-${identity}`}
                              >
                                Change
                              </summary>
                              <ExerciseLibraryPicker
                                movements={rehabMovements}
                                excludeKeys={drafts.map((row) => row.movement)}
                                onPick={(movement) => {
                                  const key = catalogMovementKey(movement.id);
                                  setCatalogMovementMeta((current) => ({
                                    ...current,
                                    [key]: movement,
                                  }));
                                  replaceSeriesMovement(
                                    entry.key,
                                    identity,
                                    key,
                                  );
                                }}
                              />
                            </details>
                          ) : null}
                          <button
                            type="button"
                            disabled={drafts.length <= 1}
                            onClick={() =>
                              isTriad
                                ? removeSeriesMovements(entry.key, triad)
                                : removeSeriesMovement(entry.key, identity)
                            }
                          >
                            Remove
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {removed.length > 0 ? (
                  <p
                    className={styles.note}
                    data-testid={`tb-removed-${entry.key}`}
                  >
                    {`Removed: ${removed.join(", ")}.`}
                  </p>
                ) : null}
                {tbAccessoryCaution &&
                drafts.some((row) => row.role === "accessory") ? (
                  <p
                    className={styles.note}
                    data-testid={`tb-accessory-caution-${entry.key}`}
                  >
                    {tbAccessoryCaution}
                  </p>
                ) : null}
                <details className={styles.addExercise}>
                  <summary data-testid={`tb-add-accessory-${entry.key}`}>
                    + Add accessory
                  </summary>
                  <ExerciseLibraryPicker
                    movements={accessoryMovements}
                    excludeKeys={drafts.map((row) => row.movement)}
                    onPick={(movement) => {
                      const key = catalogMovementKey(movement.id);
                      setCatalogMovementMeta((current) => ({
                        ...current,
                        [key]: movement,
                      }));
                      addSeriesAccessory(entry.key, key);
                    }}
                  />
                </details>
                <SessionLinkEditor
                  seriesKey={entry.key}
                  movements={linkable}
                  links={links}
                  onChange={setLinksForSeries}
                />
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  function renderGpPlan() {    if (!selected || selected.id !== "green-protocol") return null;
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
                      {c?.len ? " \u00B7 " : ""}
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

  function renderTbAccessories() {
    // The block was deployed before accessories were chosen by hand, so it still
    // carries auto-added work. Offer a way to drop it rather than leaving it in
    // the plan with nothing in the wizard that accounts for it.
    if (!legacyAccessories) return null;
    return (
      <div style={{ marginTop: 24, maxWidth: 560 }} data-testid="tb-accessories">
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={accessoriesOn}
            data-testid="tb-accessories-toggle"
            onChange={(e) => setAccessoriesOn(e.target.checked)}
          />
          <span className={styles.label} style={{ margin: 0 }}>
            Keep the accessory work already in this plan
          </span>
        </label>
      </div>
    );
  }

  function renderAssistanceVolume() {
    if (selected?.id !== "wendler-531") return null;
    const current =
      values.assistanceVolume === "low" || values.assistanceVolume === "high"
        ? values.assistanceVolume
        : "standard";
    const OPTIONS = [
      { value: "low", label: "Easier", hint: "One notch lighter — fewer assistance sets per category." },
      { value: "standard", label: "Balanced", hint: "The template's own assistance volume. The default." },
      { value: "high", label: "Harder", hint: "One notch heavier — more assistance sets per category." },
    ] as const;
    return (
      <div style={{ marginTop: 24, maxWidth: 560 }} data-testid="wendler-assistance-volume">
        <div className={styles.label}>Assistance volume</div>
        <p className={styles.sub} style={{ marginTop: 6 }}>
          {
            "How much push / pull / single-leg-or-core work follows your main lifts. Your main and supplemental sets are unchanged, and a template that prescribes no assistance stays that way."
          }
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {OPTIONS.map((o) => {
            const on = current === o.value;
            return (
              <button
                key={o.value}
                type="button"
                data-testid={`wendler-assistance-volume-${o.value}`}
                aria-pressed={on}
                onClick={() => setField("assistanceVolume", o.value)}
                className={styles.chip}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid var(--line, #2a2f2b)",
                  background: on ? "var(--accent, #8fb39b)" : "transparent",
                  color: on ? "#0f1310" : "inherit",
                  cursor: "pointer",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <p className={styles.sub} style={{ marginTop: 8 }}>
          {OPTIONS.find((o) => o.value === current)?.hint}
        </p>
      </div>
    );
  }

  function renderActivationSupplementals() {
    if (!isActivation) return null;
    const groups = [
      {
        key: "armorSupplementalA",
        title: "Supp A · posterior chain + AB Triad",
        selected: armorSupplementalA,
        options: [
          {
            value: "back-extension",
            label: "Back Extensions + AB Triad",
            desc: "Loaded supplemental work at 65/70/75% of 1RM.",
          },
          {
            value: "reverse-hyper",
            label: "Reverse Hyper + AB Triad",
            desc: "Loaded supplemental work at 65/70/75% of 1RM.",
          },
        ],
      },
      {
        key: "armorSupplementalB",
        title: "Supp B · pull + overhead press",
        selected: armorSupplementalB,
        options: [
          {
            value: "pullup",
            label: "Pull-ups + Overhead Press",
            desc: "Pull-ups use 8–10 reps or max reps; overhead press uses 65/70/75% of 1RM.",
          },
          {
            value: "inverted-row",
            label: "Inverted Rows + Overhead Press",
            desc: "Inverted rows use 8–10 reps or max reps; overhead press uses 65/70/75% of 1RM.",
          },
        ],
      },
    ] as const;
    return (
      <div
        data-testid="activation-armor-supplementals"
        style={{ marginTop: 24, maxWidth: 720 }}
      >
        <div className={styles.label}>Armor supplemental clusters</div>
        <p className={styles.sub} style={{ marginTop: 6 }}>
          Choose each cluster once. The same Supp A and Supp B choices are used
          throughout all three Armor weeks.
        </p>
        <div style={{ display: "grid", gap: 18 }}>
          {groups.map((group) => (
            <div key={group.key}>
              <div className={styles.label}>{group.title}</div>
              <div className={styles.opts}>
                {group.options.map((option) => {
                  const selectedOption = group.selected === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      data-testid={`activation-${group.key}-${option.value}`}
                      onClick={() => setField(group.key, option.value)}
                      className={`${styles.opt}${
                        selectedOption ? ` ${styles.optSel}` : ""
                      }`}
                    >
                      <div className={styles.optOn}>
                        <span className={styles.optNm}>{option.label}</span>
                        {selectedOption ? (
                          <span className={styles.pill}>Selected</span>
                        ) : null}
                      </div>
                      <div className={styles.optDesc}>
                        3–5 sets of 8–10 reps. {option.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderLoadoutStep() {
    if (!selected) return null;
    // Setup-field programs (Hybrid goal chips / HYROX experience+division) — no
    // template list, just the engine's describeSetup fields.
    if (!loadoutKey) {
      return (
        <div className={styles.step}>
          <h2 className={styles.h1}>{isHyrox ? "Set up your race build" : "Build for your goals"}</h2>
          <p className={styles.sub}>
            {isHyrox
              ? "Pick your experience level (it sets a 10\u201316 week build), your division, and how many days a week you can train. You\u2019ll set your strength numbers next."
              : "Tell us what you\u2019re training for and we build a balanced concurrent plan around it \u2014 the more you set, the more it\u2019s tailored to you."}
          </p>
          <div className={styles.label}>{isHyrox ? "Your race" : "Your goals"}</div>
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
        {isTb ? (
          <div className={styles.customPanel}>
            <label className={styles.customToggle}>
              <input
                type="checkbox"
                checked={customizeTb}
                onChange={toggleCustomizeTb}
              />
              <span>
                <b>Customize template</b>
                <small>
                  {isActivation
                    ? "Customize each Activation phase while keeping its progression and milestone weeks."
                    : "Move strength and conditioning, add rehab-only days, and name the block."}
                </small>
              </span>
            </label>
            {customizeTb ? (
              <label className={styles.customName}>
                <span>Program name</span>
                <input
                  type="text"
                  value={customName}
                  maxLength={120}
                  onChange={(event) => setCustomName(event.target.value)}
                />
                <small>
                  This can be renamed at any time. The program stays marked
                  Customized in your history.
                </small>
              </label>
            ) : null}
          </div>
        ) : null}
        {renderSpecStrip()}
        {renderTbSessionPreview()}
        {renderGpPlan()}
        {!customizeTb ? renderActivationSupplementals() : null}
        {renderAssistanceVolume()}
        {renderTbAccessories()}
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
            {clusterEntry?.split ? (
              <button
                type="button"
                className={styles.schip}
                onClick={() => cycleClusterSplit(key)}
                aria-label={`${movementLabel(key)} is in session ${clusterEntry.split} \u2014 tap to switch`}
              >
                {clusterEntry.split}
              </button>
            ) : null}
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
          {canRemoveCluster(key) ? (
            <button
              type="button"
              className={styles.rm}
              onClick={() => removeClusterLift(key)}
              aria-label={`Remove ${movementLabel(key)}`}
              title="Remove"
            >
              {"\u2715"}
            </button>
          ) : null}
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

  function renderPullupRow() {
    const split = bodyweightEntry?.split;
    return (
      <div className={styles.lift}>
        <div className={styles.linfo}>
          <div className={styles.ln}>
            Pull-ups
            <span className={styles.bwtag}>max reps</span>
            {split ? (
              <button
                type="button"
                className={styles.schip}
                onClick={() => cycleClusterSplit("pullup")}
                aria-label={`Pull-ups are in session ${split} \u2014 tap to switch`}
              >
                {split}
              </button>
            ) : null}
          </div>
        </div>
        <div className={styles.right}>
          <button
            type="button"
            className={styles.rm}
            onClick={() => removeClusterLift("pullup")}
            aria-label="Remove Pull-ups"
            title="Remove"
          >
            {"\u2715"}
          </button>
          <span className={styles.inp}>
            <input
              type="number"
              step="1"
              value={pullupReps}
              onChange={(e) => setPullupRepsValue(e.target.value)}
              aria-label="Pull-up max reps"
            />
            <span className={styles.u}>reps</span>
          </span>
        </div>
      </div>
    );
  }

  function renderBenchmarksStep() {
    if (!selected) return null;
    const isCluster = !!activeTbTemplate;
    const title = isActivation
      ? "Starting maxes"
      : isCluster
      ? activeTbTemplate!.structure === "split"
        ? "Your cluster"
        : "Your strength cluster"
      : "Your benchmarks";
    const sub = isActivation
      ? "Optional when starting from Base. Its test week establishes the main lifts. A direct Armor start requires every loaded Armor max now; supplemental A is prescribed by effort and needs no max."
      : isCluster
      ? "Pick the main lifts for your cluster. Enter a 1-rep max for each, or estimate it from a recent set."
      : "Enter a 1-rep max for each lift, switch the variant, or estimate from a recent set.";

    const activationMaxCount = relevantBenchKeys.filter(
      (key) => Number(benchVals[key]?.valueStr ?? 0) > 0,
    ).length;
    const pillText = isActivation
      ? `${activationMaxCount} of ${relevantBenchKeys.length} set`
      : isCluster
      ? `${clusterValidation?.ok ? "\u2713" : "\u26A0"} ${
          clusterValidation?.ok
            ? `${clusterValidation.countingLifts} main lift${clusterValidation.countingLifts === 1 ? "" : "s"}`
            : clusterValidation?.errors[0] ?? "Adjust your cluster"
        }`
      : `\u2713 ${relevantBenchKeys.length} main lift${relevantBenchKeys.length === 1 ? "" : "s"}`;

    const is531 = selected.id === "wendler-531";
    // Load basis controls: 5/3/1 always uses a TM (user picks the %); TB loads
    // off the raw 1RM by default but can optionally derive a TM.
    const tmPct = Math.round(Number(values.tmPercent ?? (is531 ? 0.85 : 0.9)) * 100);
    const useTm = values.useTrainingMax === true;

    const note = is531
      ? `Your Training Max is ${tmPct}% of each 1RM${tmPct === 85 ? " \u2014 the 5/3/1 standard" : ""}. All working percentages run off that TM.`
      : isHyrox
        ? "Your strength sessions use these 1RMs to set their loads \u2014 a submaximal %, no Training Max needed. Your run paces and station weights come from your division standard, which you'll confirm when you log. Enter the lifts you train; you can skip any you don't."
        : isActivation
          ? "Activation owns its phase-specific exercise selection. Enter any maxes you already know; missing values remain visible and can be set from the week-5 tests before Armor begins."
        : isCluster && activeTbTemplate!.structure === "split"
          ? `Tactical Barbell loads ${useTm ? `off a Training Max (${tmPct}% of your 1RM)` : "a submaximal % of your 1RM"}. Each lift sits in an A or B session; you train each session twice a week. Tap the A/B chip to move a lift.`
          : `Tactical Barbell loads ${useTm ? `off a Training Max (${tmPct}% of your 1RM)` : "a submaximal % of your 1RM \u2014 no Training Max required"}.${
              bodyweightEntry
                ? " An optional bodyweight movement (e.g. pull-ups) doesn\u2019t count toward the cap and is set as a % of your max reps, not a weight."
                : " Switch a lift\u2019s variant from its dropdown."
            }`;

    const lockHint =
      selected.id === "wendler-531"
        ? "\uD83D\uDD12 5/3/1 always trains the four main lifts \u2014 squat, bench, deadlift and press."
        : isActivation
          ? "\uD83D\uDD12 Activation uses a fixed, phase-specific loadout. These fields only set starting loads; they do not change the exercises."
        : isCluster && activeTbTemplate!.clusterMin === activeTbTemplate!.clusterMax
          ? `\uD83D\uDD12 ${activeTbTemplate!.name} uses a fixed cluster of exactly ${activeTbTemplate!.clusterMax} lifts. Swap a lift by changing its variant.`
          : null;

    return (
      <div className={styles.step} style={{ position: "relative" }}>
        <h2 className={styles.h1}>{title}</h2>
        <p className={styles.sub}>{sub}</p>

        {!benchmarksReady && !isActivation && (
          <p className={styles.banner}>
            {activeTbTemplate?.fixedLoadout
              ? `Add a 1-rep max for ${missingRelevantBenchKeys
                  .map((key) => movementLabel(key))
                  .join(", ")} so every programmed lift has a real load.`
              : "Enter a 1-rep max for each lift below so the program can set your weights."}
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

        {isCluster && activeTbTemplate!.structure === "split" && (
          <p className={styles.note} style={{ marginTop: 0, marginBottom: 12 }}>
            {activeTbTemplate!.name} splits your lifts across an A and a B session.
          </p>
        )}

        <div className={styles.lifts}>
          {relevantBenchKeys.map((k) => renderBenchRow(k))}
          {isCluster && !isActivation && bodyweightEntry ? renderPullupRow() : null}
        </div>

        {isCluster && (clusterEditable || canAddBodyweight || bodyweightEntry) && (
          <div className={styles.addwrap}>
            {clusterEditable && (
              <button
                type="button"
                className={styles.addlift}
                onClick={addClusterLift}
                disabled={!canAddCluster}
              >
                {"\uFF0B Add lift"}
              </button>
            )}
            {canAddBodyweight && (
              <button
                type="button"
                className={`${styles.addlift} ${styles.addliftBw}`}
                onClick={addBodyweightLift}
              >
                {"\uFF0B Optional bodyweight (pull-ups)"}
              </button>
            )}
          </div>
        )}

        {lockHint && <div className={styles.lockhint}>{lockHint}</div>}

        {is531 ? (
          <div className={styles.basisRow}>
            <span className={styles.basisLabel}>Training Max</span>
            <div className={styles.toggle}>
              {[80, 85, 90].map((p) => (
                <button
                  key={p}
                  type="button"
                  className={tmPct === p ? styles.toggleOn : undefined}
                  onClick={() => setField("tmPercent", p / 100)}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
        ) : isCluster ? (
          <div className={styles.basisRow}>
            <span className={styles.basisLabel}>Load off</span>
            <div className={styles.toggle}>
              <button
                type="button"
                className={!useTm ? styles.toggleOn : undefined}
                onClick={() => setField("useTrainingMax", false)}
              >
                1RM
              </button>
              <button
                type="button"
                className={useTm ? styles.toggleOn : undefined}
                onClick={() => setField("useTrainingMax", true)}
              >
                Training Max
              </button>
            </div>
            {useTm && (
              <div className={styles.toggle}>
                {[85, 90, 95].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={tmPct === p ? styles.toggleOn : undefined}
                    onClick={() => setField("tmPercent", p / 100)}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

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
    const activationSummaryPhase = activationSummaryPhaseFor(
      startWeekIndex,
      isEditing ? editContext : undefined,
    );
    const activationStartWeekText =
      customizeTb && isActivation && activationSummaryPhase
        ? (() => {
            const phase = activeTbTemplate?.activationPhases?.find(
              (candidate) => candidate.key === activationSummaryPhase,
            );
            const enabled = (phase?.sessions ?? []).filter(
              (session) =>
                activationDrafts[activationSummaryPhase].sessions[
                  session.key
                ]?.enabled,
            );
            const strength = enabled.filter(
              (session) => session.type === "strength",
            ).length;
            const conditioning = enabled.length - strength;
            const rehabDays = Object.keys(
              activationDrafts[activationSummaryPhase].rehabAssignments,
            ).map(Number);
            const rehab = rehabDays.length;
            const occupiedDays = new Set([
              ...enabled.map(
                (session) =>
                  activationDrafts[activationSummaryPhase].sessions[
                    session.key
                  ]!.day,
              ),
              ...rehabDays,
            ]);
            const rest = Math.max(
              0,
              7 - occupiedDays.size,
            );
            return `${strength} strength · ${conditioning} conditioning · ${rehab} rehab · ${rest} rest`;
          })()
        : null;
    const weekText = activationStartWeekText
      ? activationStartWeekText
      : selectedStartSchedule
      ? `${selectedStartSchedule.strength} strength \u00B7 ${selectedStartSchedule.cardio} cardio \u00B7 ${selectedStartSchedule.rest} rest`
      : supportsCardioDays
        ? `${dayCounts.strength} strength \u00B7 ${dayCounts.cardio} conditioning${
            customizeTb ? ` \u00B7 ${dayCounts.rehab} rehab` : ""
          } \u00B7 ${dayCounts.rest} rest`
        : `${dayCounts.strength} ${daysNoun} \u00B7 ${dayCounts.rest} rest`;
    // HYROX without a race date is an ongoing maintenance build — no Race-prep,
    // no Taper (ADR 0060). Only show the full four-phase periodisation when a race
    // date is set; otherwise it's Base -> Build held steady.
    const structValue =
      selected.id === "hyrox" && !raceDate
        ? "Base \u2192 Build (ongoing, no taper)"
        : (loadoutMeta?.struct ?? "\u2014");
    return (
      <div className={styles.summary}>
        <div className={styles.srow}>
          <span className={styles.sk}>Program</span>
          <span className={styles.sv}>
            <b>
              {customizeTb
                ? customName.trim() || DEFAULT_CUSTOM_TB_NAME
                : PROGRAM_LABEL[selected.id] ?? selected.name}
            </b>
            {customizeTb ? (
              <span className={styles.customBadge}>Customized</span>
            ) : null}
          </span>
        </div>
        <div className={styles.srow}>
          <span className={styles.sk}>Template</span>
          <span className={styles.sv}>{tmplLabel}</span>
        </div>
        <div className={styles.srow}>
          <span className={styles.sk}>{loadoutMeta?.structLabel ?? "Structure"}</span>
          <span className={styles.sv}>{structValue}</span>
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

  function renderRehabProtocolEditor() {
    return (
      <div>
        <div className={styles.label}>Rehab protocols</div>
        {libraryProtocols.length === 0 ? (
          <p className={styles.note} data-testid="rehab-library-empty">
            No rehab protocols yet. Create one in Settings &rarr; Rehab
            protocols, then pick it here.
          </p>
        ) : (
          <div className={styles.rehabProtocols}>
            {libraryProtocols.map((protocol) => {
              const checked = selectedProtocolIds.includes(protocol.id);
              return (
                <label
                  key={protocol.id}
                  className={styles.rehabProtocolCard}
                  data-testid={`rehab-protocol-option-${protocol.id}`}
                  data-selected={checked ? "true" : "false"}
                  style={{
                    display: "flex",
                    gap: 11,
                    alignItems: "flex-start",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleProtocol(protocol.id)}
                    aria-label={protocol.name}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600 }}>
                      {protocol.name}
                    </span>
                    <span
                      style={{ display: "block", fontSize: 12, opacity: 0.75 }}
                    >
                      {protocol.summary}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <a
          className={styles.addlift}
          href="/app/settings/rehab-protocols"
          data-testid="rehab-library-link"
        >
          Manage rehab protocols
        </a>
      </div>
    );
  }

  function renderActivationCustomization() {
    if (!activeTbTemplate?.activationPhases) return null;
    const phaseEndWeek: Record<ActivationPhaseKey, number> = {
      base: 3,
      armor: 7,
      operator: 18,
      vertex: 23,
    };
    // Which phase the plan actually begins in. This used to auto-expand that
    // phase; it now only labels it. Expanding one phase pushed every later
    // phase off-screen behind a wall of session rows, so the list stopped
    // reading as a list — and the phase you want is not always the one you
    // start in. Collapsed-by-default keeps all four phases visible at once and
    // makes opening one a deliberate act.
    const startPhaseIndex = Math.max(
      0,
      activeTbTemplate.activationPhases.findIndex(
        (phase) => phaseEndWeek[phase.key] >= startWeekIndex,
      ),
    );
    return (
      <div
        className={styles.activationBuilder}
        data-testid="activation-custom-builder"
      >
        <div className={styles.rehabProtocolPanel}>
          {renderRehabProtocolEditor()}
        </div>
        {activeTbTemplate.activationPhases.map((phase, phaseIndex) => {
          const phaseDraft = activationDrafts[phase.key];
          const absoluteCurrentWeek =
            (editContext?.programStartWeekIndex ?? 0) +
            (editContext?.currentWeekIndex ?? 0);
          const beforeStart =
            phaseEndWeek[phase.key] < startWeekIndex;
          const phaseLocked =
            beforeStart ||
            (isEditing &&
              phaseEndWeek[phase.key] < absoluteCurrentWeek);
          const occupied = new Set(
            phase.sessions.flatMap((session) => {
              const draft = phaseDraft.sessions[session.key];
              return draft?.enabled ? [draft.day] : [];
            }),
          );
          const strengthDays = new Set(
            phase.sessions.flatMap((session) => {
              const draft = phaseDraft.sessions[session.key];
              return session.type === "strength" && draft?.enabled
                ? [draft.day]
                : [];
            }),
          );
          const orderedSessions = [...phase.sessions].sort((left, right) => {
            const dayDiff =
              phaseDraft.sessions[left.key]!.day -
              phaseDraft.sessions[right.key]!.day;
            return dayDiff || left.key.localeCompare(right.key);
          });
          const orderedEnabled = orderedSessions.filter(
            (session) => phaseDraft.sessions[session.key]?.enabled,
          );
          const strengthOrder = orderedEnabled.filter(
            (session) => session.type === "strength",
          );
          const conditioningOrder = orderedEnabled.filter(
            (session) => session.type === "conditioning",
          );
          return (
            <details
              key={phase.key}
              className={styles.activationPhase}
              data-testid={`activation-phase-${phase.key}`}
            >
              <summary>
                <span>
                  <b>{phase.label}</b>
                  <small>{phase.weeks}</small>
                </span>
                <span>
                  {
                    phase.sessions.filter(
                      (session) =>
                        phaseDraft.sessions[session.key]?.enabled,
                    ).length
                  }{" "}
                  sessions · {Object.keys(phaseDraft.rehabAssignments).length} rehab
                  {phaseLocked
                    ? beforeStart
                      ? " · Before start · locked"
                      : " · Past · locked"
                    : phaseIndex === startPhaseIndex
                      ? " · Starts here"
                      : ""}
                </span>
              </summary>
              <fieldset
                className={styles.activationPhaseBody}
                disabled={phaseLocked}
              >
                <div className={styles.activationSessions}>
                  {orderedSessions.map((session) => {
                    const draft = phaseDraft.sessions[session.key]!;
                    const modalityOrder =
                      session.type === "strength"
                        ? strengthOrder
                        : conditioningOrder;
                    const ordinal =
                      modalityOrder.findIndex(
                        (candidate) => candidate.key === session.key,
                      ) + 1;
                    const scheduleName =
                      ordinal > 0
                        ? `${phase.label} · ${
                            session.type === "strength"
                              ? "Strength"
                              : "Conditioning"
                          } ${ordinal}`
                        : `${phase.label} · ${
                            session.type === "strength"
                              ? "Strength"
                              : "Conditioning"
                          } off`;
                    return (
                      <section
                        key={session.key}
                        className={styles.activationSession}
                        data-testid={`activation-session-${session.key}`}
                      >
                        <div className={styles.activationSessionHead}>
                          <span>
                            <b>{scheduleName}</b>
                            <small>
                              Uses {session.label} prescription
                            </small>
                          </span>
                          <label>
                            <span>Day</span>
                            <select
                              value={draft.day}
                              onChange={(event) =>
                                moveActivationSession(
                                  phase.key,
                                  session.key,
                                  Number(event.target.value),
                                )
                              }
                              aria-label={`${scheduleName} weekday`}
                            >
                              {WD.map((day, index) => (
                                <option
                                  key={day}
                                  value={index}
                                >
                                  {day}
                                </option>
                              ))}
                            </select>
                          </label>
                          {session.type === "conditioning" ? (
                            <label className={styles.activationEnabled}>
                              <input
                                type="checkbox"
                                checked={draft.enabled}
                                disabled={
                                  !draft.enabled && occupied.has(draft.day)
                                }
                                onChange={(event) =>
                                  patchActivationSession(
                                    phase.key,
                                    session.key,
                                    { enabled: event.target.checked },
                                  )
                                }
                              />
                              Include
                            </label>
                          ) : null}
                        </div>
                        {session.type === "strength" ? (
                          <div className={styles.activationMovements}>
                            {(() => {
                            // One derivation per session, shared by the rows and
                            // the editor below them (plan §6.9). The rows are
                            // where the lifter reads the session, so that is
                            // where a link has to be visible — describing it
                            // only in a panel underneath left two linked lifts
                            // looking like unrelated entries.
                            const linkable = activationLinkableMovements({
                              slots: session.movements,
                              selected: draft.movements,
                              labelOf: customMovementLabel,
                              builtinCircuitSources: AB_TRIAD_SOURCES,
                              builtinCircuitLabel: AB_TRIAD_LABEL,
                              builtinCircuitKey: AB_TRIAD_GROUP_KEY,
                            });
                            const links = sessionLinks[session.key] ?? [];
                            const linkBadges = slotLinkBadges(links, linkable);
                            return (
                              <>
                            {session.movements.map((slot) => {
                              const hasCompleteAbTriad =
                                AB_TRIAD_SOURCES.every((source) =>
                                  session.movements.some(
                                    (movement) =>
                                      movement.sourceMovement === source,
                                  ),
                                );
                              if (
                                hasCompleteAbTriad &&
                                AB_TRIAD_SOURCE_SET.has(slot.sourceMovement)
                              ) {
                                if (
                                  slot.sourceMovement !== AB_TRIAD_SOURCES[0]
                                ) {
                                  return null;
                                }
                                const triadSelections =
                                  AB_TRIAD_SOURCES.map(
                                    (source) => draft.movements[source],
                                  );
                                const selectedTriadCount =
                                  triadSelections.filter(
                                    (movement) => movement != null,
                                  ).length;
                                const selectedInSession = Object.values(
                                  draft.movements,
                                ).filter(
                                  (movement): movement is string =>
                                    movement != null,
                                );
                                const canonicalTriad =
                                  AB_TRIAD_SOURCES.every(
                                    (source, index) =>
                                      triadSelections[index] === source,
                                  );
                                const singleReplacement =
                                  selectedTriadCount === 1
                                    ? triadSelections.find(
                                        (movement) => movement != null,
                                      ) ?? null
                                    : null;
                                const canRemove =
                                  selectedTriadCount > 0 &&
                                  selectedInSession.length >
                                    selectedTriadCount;
                                const currentSequence =
                                  triadSelections
                                    .map((movement) =>
                                      movement
                                        ? customMovementLabel(movement)
                                        : "Removed",
                                    )
                                    .join(" → ");
                                return (
                                  <div
                                    key="ab-triad"
                                    className={rowLinkClass(
                                      styles,
                                      linkBadges.get(AB_TRIAD_SOURCES[0]!),
                                    )}
                                    data-testid={`activation-movement-${session.key}-ab-triad`}
                                  >
                                    <span className={styles.sourceSlot}>
                                      <LinkBadge
                                        styles={styles}
                                        badge={linkBadges.get(
                                          AB_TRIAD_SOURCES[0]!,
                                        )}
                                        links={links}
                                        movements={linkable}
                                        seriesKey={session.key}
                                        onChange={setLinksForSeries}
                                      />
                                      <small>Program slot</small>
                                      <b>AB Triad</b>
                                    </span>
                                    <span className={styles.currentExercise}>
                                      <small>Exercise</small>
                                      <b>
                                        {canonicalTriad
                                          ? "AB Triad"
                                          : singleReplacement
                                            ? customMovementLabel(
                                                singleReplacement,
                                              )
                                            : selectedTriadCount > 0
                                              ? currentSequence
                                              : "Removed"}
                                      </b>
                                      <em>
                                        {canonicalTriad
                                          ? "Hanging Leg Raise → Hanging Knee Raise → Toes-to-Bar · 3 rounds × 5 each"
                                          : singleReplacement &&
                                              catalogMovementMeta[
                                                singleReplacement
                                              ]?.hasOneRm
                                            ? "Uses its saved 1RM"
                                            : singleReplacement?.startsWith(
                                                  "catalog:",
                                                )
                                              ? "Manual load"
                                          : selectedTriadCount > 0
                                                ? "Custom composition"
                                                : "Removed"}
                                      </em>
                                    </span>
                                    <div className={styles.exerciseActions}>
                                      <details>
                                        <summary>Change</summary>
                                        <ExerciseLibraryPicker
                                          movements={rehabMovements}
                                          excludeKeys={selectedInSession}
                                          onPick={(movement) => {
                                            const key =
                                              catalogMovementKey(movement.id);
                                            setCatalogMovementMeta(
                                              (current) => ({
                                                ...current,
                                                [key]: movement,
                                              }),
                                            );
                                            setActivationMovements(
                                              phase.key,
                                              session.key,
                                              Object.fromEntries(
                                                AB_TRIAD_SOURCES.map(
                                                  (source, index) => [
                                                    source,
                                                    index === 0 ? key : null,
                                                  ],
                                                ),
                                              ),
                                            );
                                          }}
                                        />
                                      </details>
                                      {!canonicalTriad && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setActivationMovements(
                                              phase.key,
                                              session.key,
                                              Object.fromEntries(
                                                AB_TRIAD_SOURCES.map(
                                                  (source) => [source, source],
                                                ),
                                              ),
                                            )
                                          }
                                        >
                                          Restore AB Triad
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        disabled={!canRemove}
                                        onClick={() =>
                                          setActivationMovements(
                                            phase.key,
                                            session.key,
                                            Object.fromEntries(
                                              AB_TRIAD_SOURCES.map((source) => [
                                                source,
                                                null,
                                              ]),
                                            ),
                                          )
                                        }
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              const selectedMovement =
                                draft.movements[slot.sourceMovement];
                              const selectedInSession = Object.values(
                                draft.movements,
                              ).filter(
                                (movement): movement is string =>
                                  movement != null,
                              );
                              const canRemove =
                                selectedMovement != null &&
                                selectedInSession.length > 1;
                              return (
                                <div
                                  key={slot.sourceMovement}
                                  className={rowLinkClass(
                                    styles,
                                    linkBadges.get(slot.sourceMovement),
                                  )}
                                  data-testid={`activation-movement-${session.key}-${slot.sourceMovement}`}
                                >
                                  <span className={styles.sourceSlot}>
                                    <LinkBadge
                                      styles={styles}
                                      badge={linkBadges.get(slot.sourceMovement)}
                                      links={links}
                                      movements={linkable}
                                      seriesKey={session.key}
                                      onChange={setLinksForSeries}
                                    />
                                    <small>Program slot</small>
                                    <b>
                                      {movementLabel(
                                        slot.sourceMovement,
                                      )}
                                    </b>
                                  </span>
                                  <span className={styles.currentExercise}>
                                    <small>Exercise</small>
                                    <b>
                                      {selectedMovement
                                        ? customMovementLabel(
                                            selectedMovement,
                                          )
                                        : "Removed"}
                                    </b>
                                    <em>
                                      {selectedMovement &&
                                      catalogMovementMeta[
                                        selectedMovement
                                      ]?.hasOneRm
                                        ? "Uses its saved 1RM"
                                        : selectedMovement?.startsWith(
                                              "catalog:",
                                            )
                                          ? "Manual load"
                                          : "Programmed loading"}
                                    </em>
                                  </span>
                                  <div className={styles.exerciseActions}>
                                    <details>
                                      <summary>Change</summary>
                                      <ExerciseLibraryPicker
                                        movements={rehabMovements}
                                        excludeKeys={selectedInSession}
                                        onPick={(movement) => {
                                          const key =
                                            catalogMovementKey(
                                              movement.id,
                                            );
                                          setCatalogMovementMeta(
                                            (current) => ({
                                              ...current,
                                              [key]: movement,
                                            }),
                                          );
                                          setActivationMovement(
                                            phase.key,
                                            session.key,
                                            slot.sourceMovement,
                                            key,
                                          );
                                        }}
                                      />
                                    </details>
                                    <button
                                      type="button"
                                      disabled={!canRemove}
                                      onClick={() =>
                                      setActivationMovement(
                                        phase.key,
                                        session.key,
                                        slot.sourceMovement,
                                        null,
                                      )}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                            {Object.values(draft.movements).every(
                              (movement) => movement == null,
                            ) ? (
                              <p className={styles.inlineError}>
                                Keep or replace at least one movement.
                              </p>
                            ) : null}
                            <SessionLinkEditor
                              seriesKey={session.key}
                              movements={linkable}
                              links={links}
                              onChange={setLinksForSeries}
                            />
                              </>
                            );
                            })()}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
                <div>
                  <div className={styles.label}>Rehab protocol by day</div>
                  <div className={styles.activationRehabDays}>
                    {WD.map((day, index) => {
                      const selected =
                        phaseDraft.rehabAssignments[index] ?? "";
                      const sharesWorkout = occupied.has(index);
                      const sharesStrength = strengthDays.has(index);
                      return (
                        <label
                          key={day}
                          className={selected ? styles.selected : ""}
                          title={
                            sharesWorkout
                              ? sharesStrength
                                ? "Included as the warm-up rehab section in this strength workout"
                                : "Adds a separate rehab session beside this conditioning workout"
                              : "Adds a rehab-only session"
                          }
                        >
                          <span>
                            {day}
                            {sharesWorkout ? " +" : ""}
                          </span>
                          <select
                            value={selected}
                            onChange={(event) =>
                              setActivationRehabProtocol(
                                phase.key,
                                index,
                                event.target.value,
                              )
                            }
                            aria-label={`${phase.label} ${day} rehab protocol`}
                          >
                            <option value="">No rehab</option>
                            {rehabProtocols.map((protocol) => (
                              <option key={protocol.id} value={protocol.id}>
                                {protocol.name || "Unnamed protocol"}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </fieldset>
            </details>
          );
        })}
      </div>
    );
  }

  function renderScheduleStep() {
    if (!selected) return null;
    const hyroxTooFew = isHyrox && dayCounts.strength < HYROX_MIN_DAYS;
    const countWarn =
      (!fixedSchedule && requiredDays != null && dayCounts.strength !== requiredDays) || hyroxTooFew;
    const countText = hyroxTooFew
      ? `\u26A0 ${dayCounts.strength} training ${dayCounts.strength === 1 ? "day" : "days"} \u2014 pick at least ${HYROX_MIN_DAYS}`
      : countWarn
      ? `\u26A0 ${dayCounts.strength}/${requiredDays} strength days \u2014 pick ${requiredDays}`
      : supportsCardioDays
        ? `${dayCounts.strength} strength \u00B7 ${dayCounts.cardio} conditioning${
            customizeTb ? ` \u00B7 ${dayCounts.rehab} rehab` : ""
          } \u00B7 ${dayCounts.rest} rest`
        : `${dayCounts.strength} ${daysNoun} \u00B7 ${dayCounts.rest} rest`;
    const dirty = week.some((t, i) => t !== buildWeek(requiredDays ?? freq531)[i]);
    const schednote =
      selected.id === "wendler-531"
        ? `5/3/1 trains ${requiredDays} strength days a week. Tap a day to cycle strength \u2192 cardio \u2192 rest \u2014 keep ${requiredDays} strength days; cardio days are optional open sessions.`
        : isTb
          ? customizeTb
            ? `${activeTbTemplate?.name ?? "This template"} keeps its ${requiredDays} strength slots and progression. Tap a day to cycle Strength, Conditioning, Rehab, and Rest.`
            : `${activeTbTemplate?.name ?? "This template"} trains ${requiredDays} strength days a week \u2014 you choose which. Tap an open day to add optional conditioning, or leave it as rest.`
          : isHyrox
            ? `Pick the days you'll train (${HYROX_MIN_DAYS}\u2013${HYROX_MAX_DAYS}). The plan periodises each week across runs, stations and strength \u2014 your training-day count sets how many sessions a week it builds.`
            : "Pick which days you'll train. Your training-day count sets how many days a week the plan runs.";

    return (
      <div className={styles.step}>
        <h2 className={styles.h1}>Set your schedule</h2>
        <p className={styles.sub}>
          {fixedSchedule
            ? isActivation
              ? customizeTb
                ? "Customize each work phase. Milestone tests and peaks stay protected."
                : "Activation sets the lifting days for each phase. Pick when week 1 starts."
              : `${selected.name} plans both your lifting and conditioning days \u2014 just pick a start date.`
            : "Your training days come from your program. Pick which weekdays you'll train, then pick a start date."}
        </p>

        <div style={{ marginBottom: 18 }}>
          <div className={styles.label}>Start date</div>
          <input
            type="date"
            className={styles.datein}
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
            disabled={isEditing}
          />
          <div className={styles.note} style={{ marginTop: 6 }}>
            {isEditing
              ? "Your start date stays fixed — edits apply to untouched workouts after today, including later this week."
              : "Programs run in full weeks, so we start on a Monday by default."}
          </div>
          {selected?.id === "hyrox" ? (
            <div style={{ marginTop: 16 }}>
              <div className={styles.label}>Race date (optional)</div>
              <input
                type="date"
                className={styles.datein}
                value={raceDate}
                min={startedOn}
                onChange={(e) => setRaceDate(e.target.value)}
              />
              <div className={styles.note} style={{ marginTop: 6 }}>
                {raceDate
                  ? "Your build runs from the start date to race week, ending on a taper. We'll also add it to your races."
                  : "Leave blank for an ongoing build that holds your fitness — no taper. Add a date to peak for a specific race."}
              </div>
            </div>
          ) : null}
        </div>

        {!isEditing && segments.length > 1 ? (
          <div style={{ marginBottom: 18 }}>
            <div className={styles.label}>Start point</div>
            <select
              className={styles.datein}
              value={startWeekIndex}
              disabled={segmentsLoading}
              onChange={(e) => setStartWeekIndex(Number(e.target.value))}
            >
              {segments.map((s) => (
                <option key={s.startWeekIndex} value={s.startWeekIndex}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className={styles.note} style={{ marginTop: 6 }}>
              {startWeekIndex === 0
                ? "Begin at the start of the program."
                : "Already done some of this program elsewhere? Jump in at a later phase \u2014 your plan starts there and runs to the end."}
            </div>
          </div>
        ) : null}

        {fixedSchedule && isActivation && customizeTb ? (
          renderActivationCustomization()
        ) : fixedSchedule ? (
          <p className={styles.note}>
            {isActivation
              ? selectedStartSchedule
                ? `Starting ${selectedStartSchedule.label}: ${selectedStartSchedule.strength} strength, ${selectedStartSchedule.cardio} cardio and ${selectedStartSchedule.rest} rest ${selectedStartSchedule.rest === 1 ? "day" : "days"}. The schedule changes automatically with each phase.`
                : "Activation sets the strength and conditioning schedule for each phase."
              : `${selected.name} sets its own weekly schedule (strength and conditioning days are set by the program). It owns your calendar \u2014 you just pick the start date.`}
          </p>
        ) : (
          <>
            {loadoutMeta?.freqChoice ? (
              <div className={styles.schedFreq}>
                <div className={styles.label}>Days / week</div>
                <span className={styles.freqWrap}>
                  <span className={styles.ministep}>
                    <button type="button" onClick={() => bumpFreq(-1)} aria-label="Fewer days">
                      {"\u2013"}
                    </button>
                    <span className={styles.ministepV}>{freq531}</span>
                    <button type="button" onClick={() => bumpFreq(1)} aria-label="More days">
                      +
                    </button>
                  </span>
                  {freq531 < 4 ? (
                    <span className={styles.liftsHint}>{Math.ceil(4 / freq531)} main lifts / day</span>
                  ) : null}
                </span>
              </div>
            ) : null}
            {selected.id === "wendler-531" && freq531 === 2 ? (
              <div style={{ marginBottom: 18 }}>
                <div className={styles.label}>Lift pairing</div>
                <div
                  role="radiogroup"
                  aria-label="Lift pairing"
                  style={{ display: "grid", gap: 8, marginTop: 6 }}
                >
                  {PAIRINGS.map((p) => {
                    const sel = p.id === pairing;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={sel}
                        onClick={() => setPairing(p.id)}
                        style={{
                          display: "grid",
                          gap: 6,
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: 10,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          background: sel ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                          border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: sel ? "var(--cp-accent)" : "var(--cp-text-muted)",
                          }}
                        >
                          {p.name}
                        </span>
                        <span style={{ display: "grid", gap: 2 }}>
                          {[
                            { d: "Day 1", lifts: p.dayA },
                            { d: "Day 2", lifts: p.dayB },
                          ].map((row) => (
                            <span
                              key={row.d}
                              style={{ display: "flex", alignItems: "baseline", gap: 8 }}
                            >
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  letterSpacing: "0.06em",
                                  textTransform: "uppercase",
                                  color: "var(--cp-text-muted)",
                                  minWidth: 38,
                                }}
                              >
                                {row.d}
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--cp-text)" }}>
                                {row.lifts}
                              </span>
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className={styles.note} style={{ marginTop: 6 }}>
                  With two training days, each session trains two main lifts. Choose which lifts pair up.
                </div>
              </div>
            ) : null}
            <div className={styles.legend}>
              <span className={`${styles.lg} ${styles.lgS}`}>{daysNounCap}</span>
              {supportsCardioDays ? <span className={`${styles.lg} ${styles.lgC}`}>Conditioning</span> : null}
              {customizeTb ? <span className={`${styles.lg} ${styles.lgH}`}>Rehab</span> : null}
              <span className={`${styles.lg} ${styles.lgR}`}>Rest</span>
              <span className={`${styles.lgCount}${countWarn ? ` ${styles.lgCountWarn}` : ""}`}>{countText}</span>
            </div>
            <div className={styles.week}>
              {WD.map((label, i) => {
                const t = week[i] ?? "rest";
                const cls =
                  t === "strength"
                    ? styles.wdStrength
                    : t === "cardio"
                      ? styles.wdCardio
                      : t === "rehab"
                        ? styles.wdRehab
                        : styles.wdRest;
                const wtLabel =
                  t === "strength"
                    ? daysNounCap
                    : t === "cardio"
                      ? "Conditioning"
                      : t === "rehab"
                        ? "Rehab"
                        : "Rest";
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

            {customizeTb && activeTbTemplate ? (
              <div className={styles.customBuilder}>
                {rehabWeekdays.length > 0 ? (
                  <div>
                    <div className={styles.label}>Rehab protocol</div>
                    {libraryProtocols.length === 0 ? (
                      <p className={styles.note} data-testid="rehab-library-empty-v1">
                        No rehab protocols yet. Create one in Settings &rarr;
                        Rehab protocols, then pick it here.
                      </p>
                    ) : (
                      <div className={styles.rehabProtocols}>
                        {libraryProtocols.map((protocol) => {
                          // A weekly-blob program stores ONE unnamed item list,
                          // so this is a single choice, not a multi-select.
                          const checked = selectedProtocolIds[0] === protocol.id;
                          return (
                            <label
                              key={protocol.id}
                              className={styles.rehabProtocolCard}
                              data-testid={`rehab-protocol-option-${protocol.id}`}
                              data-selected={checked ? "true" : "false"}
                              style={{
                                display: "flex",
                                gap: 11,
                                alignItems: "flex-start",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="radio"
                                name="rehab-protocol"
                                checked={checked}
                                onChange={() => setSelectedProtocolIds([protocol.id])}
                                aria-label={protocol.name}
                                style={{ marginTop: 3 }}
                              />
                              <span style={{ minWidth: 0 }}>
                                <span style={{ display: "block", fontWeight: 600 }}>
                                  {protocol.name}
                                </span>
                                <span
                                  style={{ display: "block", fontSize: 12, opacity: 0.75 }}
                                >
                                  {protocol.summary}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <a
                      className={styles.addlift}
                      href="/app/settings/rehab-protocols"
                      data-testid="rehab-library-link-v1"
                    >
                      Manage rehab protocols
                    </a>
                    {selectedProtocolIds.length === 0 ? (
                      <p className={styles.inlineError}>
                        Pick a rehab protocol for your rehab day.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {isActivation && !activationStartBenchmarksReady ? (
          <p className={styles.banner}>
            Starting {selectedStartSchedule?.label ?? "this phase"} requires a
            1-rep max for{" "}
            {missingActivationStartBenchKeys
              .map((key) => movementLabel(key))
              .join(", ")}
            . Go back to Starting maxes to add them before deploying.
          </p>
        ) : null}

        {(isHybrid || isHyrox) ? (
          <div style={{ marginTop: 24, maxWidth: 560 }} data-testid="two-a-day">
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={twoADay}
                data-testid="hybrid-two-a-day-toggle"
                onChange={(e) => setTwoADay(e.target.checked)}
              />
              <span className={styles.label} style={{ margin: 0 }}>
                Two-a-day sessions (optional)
              </span>
            </label>
            <p className={styles.sub} style={{ marginTop: 6 }}>
              {isHyrox
                ? "Adds an easy off-feet erg (ski/row/bike) as a PM session on some hard days \u2014 extra aerobic volume without the leg impact. Leave 6\u20138 hours after your main session so the two don\u2019t blunt each other."
                : "Split eligible training days into an AM lift + PM cardio, ideally 6+ hours apart so the lifting and cardio don\u2019t blunt each other. Applies to this block only \u2014 leave off for a single session per day."}
            </p>
          </div>
        ) : null}

        {renderSummary()}
      </div>
    );
  }

  const isFinalStep = step === 3;

  return (
    <div className={styles.wizard}>
      {/* Exit hatch. The wizard's own "Back" button walks the step rail, so
          without this there is no way out of the flow. Editing implies an
          active block (Plan renders); a fresh run may have none, and
          /app/plan redirects blockless users straight back here — so send
          them to Today instead of into a loop. */}
      <BackLink href={isEditing ? "/app/plan" : "/app"} label={isEditing ? "Plan" : "Today"} />
      <h1 className={styles.pageTitle}>{isEditing ? "Edit your plan" : "Start a program"}</h1>

      {isEditing && (
        <div
          className="cp-card"
          style={{
            padding: "10px 14px",
            margin: "0 0 4px",
            fontSize: 13,
            color: "var(--cp-text-muted, #9aa0a6)",
            borderColor: "var(--cp-border)",
          }}
        >
          Editing your active {editProgram?.name ?? "plan"}. Past, today, and
          anything already started or skipped stay unchanged; open workouts
          after today can be regenerated.
        </div>
      )}

      <div className={styles.top}>
        <div className={styles.stepcount} style={{ marginLeft: "auto" }}>
          STEP <b>{step + 1}</b> / 4
        </div>
      </div>

      <div className={styles.rail}>
        {STEP_LABELS.map((label, i) => {
          const navigable = i >= minStep && i <= maxStep && i !== step;
          return (
            <div
              key={label}
              role={navigable ? "button" : undefined}
              tabIndex={navigable ? 0 : undefined}
              aria-label={navigable ? `Go to ${label}` : undefined}
              onClick={navigable ? () => goToStep(i) : undefined}
              onKeyDown={
                navigable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        goToStep(i);
                      }
                    }
                  : undefined
              }
              className={`${styles.seg}${i === step ? ` ${styles.segActive}` : i < step ? ` ${styles.segDone}` : ""}${navigable ? ` ${styles.segNav}` : ""}`}
            >
              <i />
            </div>
          );
        })}
      </div>
      <div className={styles.raillabels}>
        {STEP_LABELS.map((label, i) => {
          const navigable = i >= minStep && i <= maxStep && i !== step;
          return navigable ? (
            <button
              key={label}
              type="button"
              onClick={() => goToStep(i)}
              className={`${styles.rlBtn}${i === step ? ` ${styles.rlActive}` : ""}`}
            >
              {label}
            </button>
          ) : (
            <span key={label} className={i === step ? styles.rlActive : undefined}>
              {label}
            </span>
          );
        })}
      </div>

      {step === 0 && renderProgramStep()}
      {step === 1 && renderLoadoutStep()}
      {step === 2 && renderBenchmarksStep()}
      {step === 3 && renderScheduleStep()}

      <div className={styles.nav}>
        {step > minStep ? (
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
              {isEditing
                ? pending
                  ? "Saving…"
                  : "Save changes"
                : pending
                  ? "Deploying…"
                  : "Deploy program"}
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
        {body.split("\n\n").map((para, i) => (
          <p key={i} className={styles.modalP}>
            {para}
          </p>
        ))}
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
