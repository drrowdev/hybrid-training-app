"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeAppRedirectPath } from "@/lib/auth/redirect-path";

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

  redirect(safeAppRedirectPath(String(formData.get("next") ?? "")));
}

/**
 * Email one-time-code sign-in (step 1): server emails a 6-digit code.
 *
 * Uses the same `signInWithOtp` primitive as the old magic link; whether the
 * email contains a clickable link or a 6-digit code is decided by the Supabase
 * "Magic Link" email template (`{{ .Token }}` => code). We deliberately do NOT
 * pass `emailRedirectTo` here: that option biases Supabase toward minting a
 * link. Omitting it keeps the token (code) front-and-centre. The user then
 * submits the code to `verifyEmailCode` (step 2).
 *
 * Codes keep the session inside the app — critical for the native iOS shell,
 * where a magic link would punt the user out to Safari and strand the session
 * there instead of returning to the WKWebView.
 */
export async function sendEmailCode(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Email required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // While sign-ups are disabled, a code must only authenticate an
      // existing user — never silently provision a new account.
      shouldCreateUser: SIGNUPS_ENABLED,
    },
  });
  if (error) return { error: error.message };

  return { ok: true as const, message: "We emailed you a 6-digit code." };
}

/**
 * Email one-time-code sign-in (step 2): verify the 6-digit code and start the
 * session. On success this sets the auth cookies and redirects, so the native
 * shell never has to leave the app.
 */
export async function verifyEmailCode(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  if (!email || !token) return { error: "Email and code required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) return { error: error.message };

  redirect(safeAppRedirectPath(String(formData.get("next") ?? "")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
