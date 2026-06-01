"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Master switch for self-service account creation. While the app is in the
 * private testing phase we do NOT want new users signing themselves up, so
 * this is `false`: the `signUp` action is short-circuited and the magic-link
 * flow is restricted to existing users (`shouldCreateUser: false`). Flip to
 * `true` (or wire to an env flag) to re-open public sign-ups.
 */
const SIGNUPS_ENABLED = false;

/**
 * Email + password signup. Supabase Auth will email a confirmation link.
 * The handle_new_user() DB trigger auto-creates a `profiles` row on insert.
 */
export async function signUp(formData: FormData) {
  if (!SIGNUPS_ENABLED) {
    return { error: "New sign-ups are currently disabled." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email + password required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`,
    },
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Email + password sign-in.
 */
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email + password required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  const next = String(formData.get("next") ?? "/app");
  redirect(next);
}

/**
 * Magic-link sign-in: server emails a single-use login URL.
 */
export async function signInWithMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Email required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // While sign-ups are disabled, a magic link must only authenticate an
      // existing user — never silently provision a new account.
      shouldCreateUser: SIGNUPS_ENABLED,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/callback`,
    },
  });
  if (error) return { error: error.message };

  return { ok: true as const, message: "Check your email for a sign-in link." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
