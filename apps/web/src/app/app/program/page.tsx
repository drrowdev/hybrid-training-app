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
 * Only programs with a wired deploy path are enabled (5/3/1 today); the rest
 * are shown as "coming soon".
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { selectablePrograms, getProgramEngine } from "@/lib/platform/registry";
import { buildPlatformContext } from "@/lib/platform/context";
import { ProgramPicker, type PickerProgram } from "@/components/program/ProgramPicker";

// Programs whose deploy path is validated end-to-end. Others render disabled.
const ENABLED_PROGRAM_IDS = new Set<string>(["wendler-531"]);

export default async function ProgramPickerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { anchoredKeys } = await buildPlatformContext(supabase, user.id);

  const programs: PickerProgram[] = selectablePrograms().map((meta) => {
    const engine = getProgramEngine(meta.id);
    const fields = engine?.describeSetup().fields ?? [];
    return {
      id: meta.id,
      name: meta.name,
      family: meta.family,
      summary: meta.summary,
      enabled: ENABLED_PROGRAM_IDS.has(meta.id),
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        ...(f.options ? { options: f.options } : {}),
        ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
        ...(f.help ? { help: f.help } : {}),
      })),
    };
  });

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

      <ProgramPicker programs={programs} anchoredKeys={anchoredKeys} />
    </div>
  );
}
