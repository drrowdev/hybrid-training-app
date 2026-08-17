/**
 * Minimal program picker route (platform cutover PR4).
 *
 * Server component: resolves the program catalogue + each program's
 * engine-described setup fields, and the user's anchored lifts (from the
 * platform context). Renders the client picker, which deploys via
 * `createProgramInstance`. Lives at a NEW route alongside the existing
 * archetype flow so the platform path can be validated end-to-end before the
 * archetype onboarding is retired.
 *
 * Only programs with a wired deploy path are enabled (5/3/1 + Tactical Barbell
 * today); the rest are shown as "coming soon".
 */
import { redirect } from "next/navigation";
import { Archivo, Oswald, Saira_Stencil_One, JetBrains_Mono } from "next/font/google";
import type { PlatformContext, ProgramEngine, PlannedSessionSpec } from "@hta/program-core";
import {
  ACTIVATION_PHASE_KEYS,
  ACTIVATION_PHASE_LABELS,
  TB_TEMPLATES,
  activationCustomizationKey,
  isSupplementalSlot,
  activationPhaseForSession,
} from "@hta/tacticalbarbell";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { selectablePrograms, getProgramEngine, getNativeProgramEngine } from "@/lib/platform/registry";
import { buildPlatformContext } from "@/lib/platform/context";
import { getBlockEditContext } from "@/lib/platform/edit-context";
import { getActiveSeason } from "@/lib/seasons/queries";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import { STRENGTH_ROLE_CANDIDATES, type StrengthRole } from "@/lib/planner/archetypes";
import {
  ENGINE_KEY_TO_ROLE,
  STATIC_ENGINE_MOVEMENTS,
} from "@/lib/platform/movement-keys";
import {
  ProgramPicker,
  type PickerProgram,
  type PickerTbTemplate,
  type PickerBenchRole,
  type PickerRehabMovement,
} from "@/components/program/ProgramPicker";
import { loadPickerCatalog } from "@/lib/planner/picker-catalog";

// Sage program-wizard type scale — scoped to this route via CSS variables on
// the wrapper below (see ProgramPicker.module.css). Not loaded app-wide.
const archivo = Archivo({ subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700"], variable: "--font-archivo" });
const oswald = Oswald({ subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700"], variable: "--font-oswald" });
const saira = Saira_Stencil_One({ subsets: ["latin"], display: "swap", weight: "400", variable: "--font-saira" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], display: "swap", weight: ["500", "700"], variable: "--font-mono-wizard" });

// Programs whose deploy path is validated end-to-end. Others render disabled.
const ENABLED_PROGRAM_IDS = new Set<string>([
  "hybrid",
  "wendler-531",
  "tactical-barbell",
  "green-protocol",
  "hyrox",
]);

// Programs that prescribe their own weekly calendar (every session carries an
// explicit weekday) — the picker hides its weekday chooser for these. Green
// Protocol owns its own calendar (hand-authored week tables). Hybrid and HYROX do
// NOT: like 5/3/1 and TB, the user picks training weekdays on the shared Schedule
// step, and that count drives the program's sessions/week.
const FIXED_SCHEDULE_PROGRAM_IDS = new Set<string>(["green-protocol"]);

/**
 * Sessions a single program-week contains under the engine's DEFAULT setup —
 * i.e. how many training weekdays the user must pick. Built by instantiating the
 * default instance and counting the first weekLabel group of the timeline.
 * Best-effort: returns undefined if the engine can't be set up without real
 * user state (only used as a scheduling hint for enabled programs).
 */
function defaultSessionsPerWeek(engine: ProgramEngine): number | undefined {
  try {
    const values: Record<string, unknown> = {};
    for (const f of engine.describeSetup().fields) {
      if (f.defaultValue !== undefined) values[f.key] = f.defaultValue;
    }
    const emptyCtx: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };
    const instance = engine.setup({ values }, emptyCtx);
    const timeline = engine.timeline(instance) as PlannedSessionSpec[];
    const firstTraining = timeline.find((s) => s.kind !== "rest");
    if (!firstTraining) return undefined;
    const firstLabel = firstTraining.weekLabel ?? `__idx${firstTraining.index}`;
    return timeline.filter((s) => s.kind !== "rest" && (s.weekLabel ?? `__idx${s.index}`) === firstLabel)
      .length;
  } catch {
    return undefined;
  }
}

export default async function ProgramPickerPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; phase?: string; edit?: string; seasonBlockId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { anchoredKeys } = await buildPlatformContext(supabase, user.id);

  // Benchmark catalogue for the picker's "Benchmarks" step: each main-lift role
  // (squat / horizontal_press / deadlift / vertical_press) with its selectable
  // movement variants (resolved to catalog movement ids so the picker can write
  // 1-rep maxes on deploy) plus the user's currently-anchored variant + 1RM.
  const benchRoles: PickerBenchRole[] = await buildBenchRoles(supabase);

  // The optional bodyweight movement (Tactical Barbell Operator's pull-up 4th).
  // Resolved to its catalog id so the picker can persist a max-reps anchor on
  // deploy; the engine prescribes it as a % of max reps.
  const pullupMovement = await buildPullupMovement(supabase);
  const [movementCatalog, trainingMaxContext] = await Promise.all([
    loadPickerCatalog(supabase),
    getTrainingMaxContext(),
  ]);
  const rehabMovements: PickerRehabMovement[] = movementCatalog
    .filter((movement) => movement.pattern !== "cardio")
    .map((movement) => ({
      id: movement.id,
      name: movement.displayName,
      slug: movement.slug,
      pattern: movement.pattern ?? "other",
      hasOneRm: trainingMaxContext.rows.some(
        (row) => row.movementId === movement.id && row.oneRmKg > 0,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const programs: PickerProgram[] = selectablePrograms().map((meta) => {
    // A program is owned by EITHER a foreign per-session engine or a native
    // (block-level) engine — both expose `describeSetup()`. Native programs are
    // fixed-schedule, so they don't need a `sessionsPerWeek` weekday hint.
    const foreignEngine = getProgramEngine(meta.id);
    const nativeEngine = getNativeProgramEngine(meta.id);
    const fields = (foreignEngine ?? nativeEngine)?.describeSetup().fields ?? [];
    return {
      id: meta.id,
      name: meta.name,
      family: meta.family,
      summary: meta.summary,
      enabled: ENABLED_PROGRAM_IDS.has(meta.id),
      ...(FIXED_SCHEDULE_PROGRAM_IDS.has(meta.id) ? { fixedSchedule: true } : {}),
      ...(nativeEngine ? { goalDriven: true } : {}),
      sessionsPerWeek: foreignEngine ? defaultSessionsPerWeek(foreignEngine) : undefined,
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        ...(f.options ? { options: f.options } : {}),
        ...(f.maxSelections !== undefined ? { maxSelections: f.maxSelections } : {}),
        ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
        ...(f.help ? { help: f.help } : {}),
      })),
    };
  });

  // Plain-data projection of TB templates for the client picker. Only the
  // cluster-shape fields cross the server→client boundary; the engine objects
  // (waves, sessions, validators) are not serialisable as props.
  const tbTemplates: PickerTbTemplate[] = TB_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    structure: t.structure,
    clusterMin: t.clusterMin,
    clusterMax: t.clusterMax,
    ...(t.allowsBodyweightFourth ? { allowsBodyweightFourth: true } : {}),
    sessionsPerWeek: t.weeklySessions.filter(
      (session) => !session.activeWeeks || session.activeWeeks.includes(1),
    ).length,
    ...(t.fixedLoadout ? { fixedLoadout: true } : {}),
    ...(t.fixedSchedule ? { fixedSchedule: true } : {}),
    ...(t.requiredBenchmarkKeys
      ? { requiredBenchmarkKeys: t.requiredBenchmarkKeys }
      : {}),
    ...(t.segments
      ? {
          startSchedules: t.segments.map((segment) => {
            const week = segment.startWeekIndex + 1;
            const sessions = t.weeklySessions.filter(
              (session) =>
                !session.activeWeeks || session.activeWeeks.includes(week),
            );
            const occupiedDays = new Set(
              sessions.flatMap((session) =>
                session.weekday == null ? [] : [session.weekday],
              ),
            );
            return {
              startWeekIndex: segment.startWeekIndex,
              label: segment.label,
              strength: sessions.filter((session) => !session.conditioning)
                .length,
              cardio: sessions.filter((session) => session.conditioning != null)
                .length,
              rest: Math.max(0, 7 - occupiedDays.size),
            };
          }),
        }
      : {}),
    defaultCluster: t.defaultCluster.map((c) => ({
      movement: c.movement,
      ...(c.split ? { split: c.split } : {}),
      ...(c.kind ? { kind: c.kind } : {}),
    })),
    sessionSeries: t.weeklySessions
      .filter(
        (session) =>
          session.conditioning == null &&
          session.kind !== "test" &&
          session.kind !== "rest" &&
          (!session.activeWeeks || session.activeWeeks.includes(1)),
      )
      .map((session, index) => ({
        key: `slot-${index + 1}`,
        label: session.label,
        movements: (session.fixedMovements ?? t.defaultCluster).map(
          (movement) => movement.movement,
        ),
        supplementalMovements: (session.fixedMovements ?? t.defaultCluster)
          .map((movement) => movement.movement)
          .filter((movement) => isSupplementalSlot(session, movement)),
        movementKinds: Object.fromEntries(
          (session.fixedMovements ?? t.defaultCluster)
            .filter((movement) => movement.kind != null)
            .map((movement) => [movement.movement, movement.kind!]),
        ) as Record<
          string,
          "barbell" | "weighted-bw" | "bodyweight" | "unanchored"
        >,
      })),
    ...(t.id === "activation"
      ? {
          activationPhases: ACTIVATION_PHASE_KEYS.map((phase) => ({
            key: phase,
            label: ACTIVATION_PHASE_LABELS[phase],
            weeks:
              phase === "base"
                ? "Weeks 1–4"
                : phase === "armor"
                  ? "Weeks 6–8"
                  : phase === "operator"
                    ? "Weeks 9–19"
                    : "Weeks 22–24",
            sessions: t.weeklySessions
              .filter(
                (session) =>
                  activationPhaseForSession(session) === phase,
              )
              .map((session) => ({
                key: activationCustomizationKey(session)!,
                label: session.label,
                type:
                  session.conditioning != null
                    ? ("conditioning" as const)
                    : ("strength" as const),
                defaultDay: session.weekday ?? 0,
                movements: (session.fixedMovements ?? []).map(
                  (movement) => ({
                    sourceMovement: movement.movement,
                    role: isSupplementalSlot(session, movement.movement)
                      ? ("supplemental" as const)
                      : ("main" as const),
                    ...(movement.kind ? { kind: movement.kind } : {}),
                  }),
                ),
              })),
          })),
        }
      : {}),
  }));

  // Optional deep-link preselect (e.g. the Today "Set up Velocity →" guided
  // advance). Only honour a program whose deploy path is enabled; the phase is
  // passed through as the program's loadout value (Green Protocol's phaseId).
  const sp = await searchParams;
  const initialProgramId =
    sp.program && ENABLED_PROGRAM_IDS.has(sp.program) ? sp.program : undefined;
  const initialLoadoutValue = initialProgramId && sp.phase ? sp.phase : undefined;

  // Edit mode (?edit=<blockId>): re-enter the wizard for the user's active
  // strength-only plan (5/3/1 / TB), prefilled with its current loadout +
  // schedule + cardio days. Null when the block isn't editable → fresh wizard.
  const editContext = sp.edit ? await getBlockEditContext(sp.edit) : null;

  // Season roadmap deep-link (ADR 0051): carries the planned season_block to
  // activate on deploy. Threaded straight through — the deploy action
  // re-validates ownership + planned status before touching the roadmap, so a
  // stale/foreign id is a safe no-op. Ignored in edit mode (not an activation).
  const seasonBlockId =
    !editContext && sp.seasonBlockId ? sp.seasonBlockId : undefined;

  // ADR 0060 — a HYROX block deployed for a season's PEAK slot must still taper to
  // the event. With the new race/no-race split, a blank race date means "no taper",
  // so for a peaking season block we pre-fill the wizard's race date from the
  // season's target event date. Non-peak season slots stay raceless (ongoing
  // maintenance — no spurious mid-season taper). The user can still clear it.
  let prefillRaceDate: string | undefined;
  if (seasonBlockId && initialProgramId === "hyrox") {
    const season = await getActiveSeason();
    const block = season?.blocks.find((b) => b.id === seasonBlockId);
    const isPeakSlot = block?.emphasis === "peak" || block?.emphasis === "realize";
    if (isPeakSlot && season?.goal?.type === "event" && season.goal.targetDate) {
      prefillRaceDate = season.goal.targetDate;
    }
  }

  return (
    <div className={`${archivo.variable} ${oswald.variable} ${saira.variable} ${jetbrains.variable}`}>
      <ProgramPicker
        programs={programs}
        anchoredKeys={anchoredKeys}
        tbTemplates={tbTemplates}
        benchRoles={benchRoles}
        rehabMovements={rehabMovements}
        {...(pullupMovement ? { pullupMovement } : {})}
        {...(initialProgramId ? { initialProgramId } : {})}
        {...(initialLoadoutValue ? { initialLoadoutValue } : {})}
        {...(editContext ? { editContext } : {})}
        {...(seasonBlockId ? { seasonBlockId } : {})}
        {...(prefillRaceDate ? { prefillRaceDate } : {})}
      />
    </div>
  );
}

/** Engine main-lift keys, in display order (squat → bench → deadlift → press). */
const BENCH_ENGINE_KEYS = ["squat", "bench", "deadlift", "press"] as const;

/**
 * Resolve every main-lift role to its catalog movement variants and the user's
 * current anchored variant + 1RM. Catalog movements are the shared (user_id NULL)
 * rows; variant ids let the picker persist entered 1-rep maxes via
 * `upsertTrainingMax` on deploy.
 */
async function buildBenchRoles(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<PickerBenchRole[]> {
  const allSlugs = Array.from(
    new Set([
      ...Object.values(STRENGTH_ROLE_CANDIDATES).flat(),
      ...Object.values(STATIC_ENGINE_MOVEMENTS).map((movement) => movement.slug),
    ]),
  );
  const { data: catalog } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .is("user_id", null)
    .in("slug", allSlugs);
  const bySlug = new Map<string, { id: string; displayName: string }>();
  for (const m of catalog ?? []) {
    bySlug.set(m.slug as string, {
      id: m.id as string,
      displayName: (m.display_name as string) ?? (m.slug as string),
    });
  }

  // The user's currently anchored 1RMs (slug-keyed), to pre-fill the inputs.
  const tm = await getTrainingMaxContext();
  const oneRmBySlug = new Map<string, number>();
  for (const r of tm.rows) {
    if (r.movementSlug) oneRmBySlug.set(r.movementSlug, r.oneRmKg);
  }

  const roles: PickerBenchRole[] = [];
  for (const engineKey of BENCH_ENGINE_KEYS) {
    const role = ENGINE_KEY_TO_ROLE[engineKey] as StrengthRole | undefined;
    if (!role) continue;
    const candidateSlugs = STRENGTH_ROLE_CANDIDATES[role] ?? [];
    const variants = candidateSlugs
      .map((slug) => {
        const hit = bySlug.get(slug);
        return hit ? { slug, label: hit.displayName, movementId: hit.id } : null;
      })
      .filter((v): v is { slug: string; label: string; movementId: string } => v !== null);
    if (variants.length === 0) continue;

    let currentSlug: string | null = null;
    let currentOneRmKg: number | null = null;
    for (const v of variants) {
      const rm = oneRmBySlug.get(v.slug);
      if (rm != null && rm > 0) {
        currentSlug = v.slug;
        currentOneRmKg = rm;
        break;
      }
    }

    roles.push({
      engineKey,
      role,
      variants,
      ...(currentSlug ? { currentSlug } : {}),
      ...(currentOneRmKg != null ? { currentOneRmKg } : {}),
    });
  }

  const activationBenchKeys = [
    "barbell-row",
    "pendlay-row",
    "rack-pull",
    "weighted-pullup",
    "back-extension",
    "reverse-hyper",
    "overhead-press",
    "power-clean",
    "push-press",
  ];
  for (const engineKey of activationBenchKeys) {
    const definition = STATIC_ENGINE_MOVEMENTS[engineKey];
    if (!definition) continue;
    const hit = bySlug.get(definition.slug);
    if (!hit) continue;
    const currentOneRmKg = oneRmBySlug.get(definition.slug);
    roles.push({
      engineKey,
      role: `tb:${engineKey}`,
      variants: [
        {
          slug: definition.slug,
          label: definition.displayName ?? hit.displayName,
          movementId: hit.id,
        },
      ],
      currentSlug: definition.slug,
      ...(currentOneRmKg != null && currentOneRmKg > 0 ? { currentOneRmKg } : {}),
    });
  }
  return roles;
}

/** The slug behind the Operator optional bodyweight pull-up (see BODYWEIGHT_ENGINE_KEY_BY_SLUG). */
const PULLUP_SLUG = "pull-up-overhand";

/**
 * Resolve the pull-up catalog movement + the user's current max-reps anchor (if
 * any) for the Tactical Barbell Operator optional bodyweight 4th. Returns null if
 * the catalog row is missing so the picker simply hides the option.
 */
async function buildPullupMovement(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ movementId: string; currentMaxReps?: number } | null> {
  const { data } = await supabase
    .from("movements")
    .select("id")
    .is("user_id", null)
    .eq("slug", PULLUP_SLUG)
    .maybeSingle();
  if (!data?.id) return null;

  const tm = await getTrainingMaxContext();
  const reps = tm.rows.find((r) => r.movementSlug === PULLUP_SLUG)?.oneRmKg;
  return {
    movementId: data.id as string,
    ...(reps != null && reps > 0 ? { currentMaxReps: reps } : {}),
  };
}
