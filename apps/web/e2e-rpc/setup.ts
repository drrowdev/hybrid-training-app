import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared setup for the RPC smoke suite.
 *
 * Env contract:
 *   SMOKE_SUPABASE_URL                — required to run the suite
 *   SMOKE_SUPABASE_SERVICE_ROLE_KEY   — required to run the suite
 *
 * If either is missing, `getSmokeEnv()` returns null and individual
 * tests should self-skip (vitest `test.skipIf` / `describe.skipIf`).
 * That keeps forks / PRs without the secrets wired up green.
 *
 * The service role bypasses RLS — these tests exercise the SQL body of
 * each RPC, not the RLS path. The README spells out the v1 limitation.
 */

export type SmokeEnv = {
  url: string;
  serviceRoleKey: string;
};

export function getSmokeEnv(): SmokeEnv | null {
  const url = process.env.SMOKE_SUPABASE_URL;
  const serviceRoleKey = process.env.SMOKE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

export const SKIP_MESSAGE =
  "RPC smoke env not configured. Set SMOKE_SUPABASE_URL and " +
  "SMOKE_SUPABASE_SERVICE_ROLE_KEY (the e2e Supabase project credentials) " +
  "to run this suite. See apps/web/e2e-rpc/README.md.";

/**
 * One run-scoped UUID-ish prefix shared across all tests in a single
 * `vitest run` invocation. Concurrent CI runs each get their own
 * prefix so cleanup never collides. Short, URL-safe; lives in the
 * `sessions.notes` text field so we can locate leaks even without
 * relying on the test's own `afterEach`.
 */
export const RUN_ID = `smoke-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

export const SMOKE_NOTE_PREFIX = `${RUN_ID}:`;

/**
 * Service-role client. Bypasses RLS. Use for setup, teardown, and the
 * RPC calls themselves in v1.
 */
export function createSmokeClient(env: SmokeEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Ensure a synthetic auth user exists for the run. The
 * `session_movements` schema NOT NULL-references `auth.users(id)` via
 * `user_id`, so the RPC needs a real user id even when we're calling
 * it as service-role. We create one user per run and delete it in
 * `cleanupRun()`.
 */
export async function createSmokeUser(
  admin: SupabaseClient,
): Promise<{ userId: string; email: string }> {
  const email = `rpc-smoke+${RUN_ID}@hta-e2e.com`;
  const password = `Smoke-${RUN_ID}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `createSmokeUser: failed to create user — ${error?.message ?? "unknown"}`,
    );
  }
  return { userId: data.user.id, email };
}

/**
 * Resolve the `movements.id` UUID for a given catalog slug. The smoke
 * suite is read-only on `movements` (it's seed data) — it just looks
 * up the row that already exists in the e2e project.
 */
export async function getMovementIdBySlug(
  admin: SupabaseClient,
  slug: string,
): Promise<string> {
  const { data, error } = await admin
    .from("movements")
    .select("id")
    .eq("slug", slug)
    .is("user_id", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`getMovementIdBySlug(${slug}): ${error.message}`);
  }
  if (!data) {
    throw new Error(
      `getMovementIdBySlug(${slug}): no catalog row found. Seed missing in e2e project?`,
    );
  }
  return data.id as string;
}

/**
 * Create a fresh session owned by `userId`, tagged with the run prefix
 * in `notes` so a leaked row can be swept later. Returns the new
 * session id. Cleanup is `deleteSession(sessionId)`; the FK cascade
 * removes any `session_movements` / `set_logs` attached.
 */
export async function createSmokeSession(
  admin: SupabaseClient,
  userId: string,
  label: string,
): Promise<string> {
  const { data, error } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      notes: `${SMOKE_NOTE_PREFIX}${label}`,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`createSmokeSession: ${error?.message ?? "no row returned"}`);
  }
  return data.id as string;
}

/**
 * Delete a session by id. Cascade removes attached
 * session_movements / set_logs rows. Best-effort; swallows errors so
 * `afterEach` doesn't itself fail the test.
 */
export async function deleteSession(
  admin: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await admin.from("sessions").delete().eq("id", sessionId);
}

/**
 * Final safety net: delete any sessions whose `notes` still carry our
 * run prefix, then drop the synthetic user. Call from `afterAll`.
 * Swallows errors — cleanup must never mask test results.
 */
export async function cleanupRun(
  admin: SupabaseClient,
  userId: string | null,
): Promise<void> {
  try {
    await admin
      .from("sessions")
      .delete()
      .like("notes", `${SMOKE_NOTE_PREFIX}%`);
  } catch {
    /* best-effort */
  }
  if (userId) {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort */
    }
  }
}
