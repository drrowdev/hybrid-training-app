"use server";

/**
 * Warmup-scheme settings server action.
 *
 * Persists the user's auto-warmup ladder configuration on
 * `profiles.warmup_scheme`. Validated server-side and well-formed
 * shape only — the client may submit anything but we coerce / reject
 * before write. Same RLS contract as the rest of settings (`id = auth.uid()`).
 *
 * NULL is a meaningful value here, not an absence: it means "follow whatever
 * ramp the program prescribes". Because migration 0039 added the column with
 * no backfill and this action is its only writer, NULL is what distinguishes a
 * lifter who has never chosen from one who deliberately picked the default
 * ladder — see `resolveWarmupPreference`. Writing NULL is therefore how the
 * "Follow the program" option makes an explicit choice REVERSIBLE.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isWellFormedScheme } from "@/lib/planner/warmups";
import { programsWithOwnWarmupRamp } from "@/lib/planner/program-warmup-scheme";
import { recordOverrideEvent } from "@/lib/engine/overrides";

const WARMUP_SCHEME_SCHEMA = z.object({
  setCount: z.coerce.number().int().min(0).max(5),
  percentLadder: z.array(z.coerce.number().min(0).max(100)).max(5),
  repLadder: z.array(z.coerce.number().int().min(1).max(20)).max(5),
});

/**
 * FormData payload:
 *   warmupSchemeJson = JSON-encoded { setCount, percentLadder, repLadder }
 *                      — or the literal `null` for "follow the program".
 */
export async function updateWarmupScheme(formData: FormData): Promise<void> {
  const raw = formData.get("warmupSchemeJson");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("Missing warmup scheme payload");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new Error("Invalid warmup scheme payload");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // "Follow the program" — clear the preference so each program's own ramp
  // applies again. Deliberately a NULL write rather than an empty ladder,
  // which would mean "skip warm-ups".
  if (candidate === null) {
    const { error } = await supabase
      .from("profiles")
      .update({ warmup_scheme: null })
      .eq("id", user.id);
    if (error) throw new Error(error.message);
    revalidatePath("/app/settings");
    revalidatePath("/app/settings/training");
    return;
  }

  const parsed = WARMUP_SCHEME_SCHEMA.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid warmup scheme");
  }
  // Tighten: ladder lengths must match setCount. The shape validator
  // enforces this once more — defence in depth.
  const scheme = parsed.data;
  if (
    scheme.percentLadder.length !== scheme.setCount ||
    scheme.repLadder.length !== scheme.setCount
  ) {
    throw new Error("Warmup ladder lengths must match the set count");
  }
  if (!isWellFormedScheme(scheme)) {
    throw new Error("Warmup scheme failed the engine validator");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ warmup_scheme: scheme })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  // DC-K4 — record the override. A configured ladder displaces the published
  // ramp of any program that prescribes its own, so the choice is audited as
  // well as warned about in the editor. Best-effort by the same contract as
  // every other recording path: a failed audit never blocks the save, and the
  // canonical record of the choice is the `profiles.warmup_scheme` row itself.
  const displaced = programsWithOwnWarmupRamp();
  if (displaced.length > 0) {
    await recordOverrideEvent(supabase, {
      userId: user.id,
      eventType: "custom",
      context: {
        kind: "warmup_ladder_override",
        scheme,
        skipsWarmups: scheme.setCount === 0,
        displacedPrograms: displaced.map((p) => p.id),
      },
    });
  }

  revalidatePath("/app/settings");
  revalidatePath("/app/settings/training");
}
