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
import Link from "next/link";
import { redirect } from "next/navigation";
import type { PlatformContext, ProgramEngine, PlannedSessionSpec } from "@hta/program-core";
import { TB_TEMPLATES } from "@hta/tacticalbarbell";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { selectablePrograms, getProgramEngine, getNativeProgramEngine } from "@/lib/platform/registry";
import { buildPlatformContext } from "@/lib/platform/context";
import {
  ProgramPicker,
  type PickerProgram,
  type PickerTbTemplate,
} from "@/components/program/ProgramPicker";

// Programs whose deploy path is validated end-to-end. Others render disabled.
const ENABLED_PROGRAM_IDS = new Set<string>([
  "hybrid",
  "wendler-531",
  "tactical-barbell",
  "green-protocol",
]);

// Programs that prescribe their own weekly calendar (every session carries an
// explicit weekday) — the picker hides its weekday chooser for these. Hybrid
// owns its calendar from the archetype + daysPerWeek (like Green Protocol).
const FIXED_SCHEDULE_PROGRAM_IDS = new Set<string>(["hybrid", "green-protocol"]);

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

export default async function ProgramPickerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { anchoredKeys } = await buildPlatformContext(supabase, user.id);

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
    sessionsPerWeek: t.weeklySessions.length,
    defaultCluster: t.defaultCluster.map((c) => ({
      movement: c.movement,
      ...(c.split ? { split: c.split } : {}),
      ...(c.kind ? { kind: c.kind } : {}),
    })),
  }));

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link
          href="/app"
          style={{ fontSize: 12, color: "var(--cp-text-muted, #999)", textDecoration: "none" }}
        >
          ← back to today
        </Link>
        <h1 style={{ fontSize: 26, margin: "8px 0 0", letterSpacing: "-0.01em" }}>Start a program</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--cp-text-muted, #999)", maxWidth: 560, lineHeight: 1.5 }}>
          Pick a training program and we build your schedule. Your strength numbers,
          history and stats stay with you — switching programs later keeps them all.
        </p>
      </header>

      <ProgramPicker programs={programs} anchoredKeys={anchoredKeys} tbTemplates={tbTemplates} />
    </div>
  );
}
