"use server";

/**
 * Warmup-scheme settings server action.
 *
 * Persists the user's auto-warmup ladder configuration on
 * `profiles.warmup_scheme`. Validated server-side and well-formed
 * shape only — the client may submit anything but we coerce / reject
 * before write. Same RLS contract as the rest of settings (`id = auth.uid()`).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isWellFormedScheme } from "@/lib/planner/warmups";

const WARMUP_SCHEME_SCHEMA = z.object({
  setCount: z.coerce.number().int().min(0).max(5),
  percentLadder: z.array(z.coerce.number().min(0).max(100)).max(5),
  repLadder: z.array(z.coerce.number().int().min(1).max(20)).max(5),
});

/**
 * FormData payload:
 *   warmupSchemeJson = JSON-encoded { setCount, percentLadder, repLadder }
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ warmup_scheme: scheme })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/app/settings");
  revalidatePath("/app/settings/training");
}
