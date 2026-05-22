import { test as base, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSeedConfig, SKIP_MESSAGE, type SeedConfig } from "./seed";

/**
 * Multi-user fixtures.
 *
 * The base `freshUser` fixture in `seed.ts` provisions exactly one
 * disposable Supabase user per test. The multi-user E2E mandated by
 * `AGENTS.md` ("at least one test that mutates state from two browser
 * contexts and verifies the server-canonical state") needs two
 * independent users in a single test so we can drive each one from its
 * own `BrowserContext` and assert RLS isolation against the canonical
 * Postgres state.
 *
 * This file adds:
 *   - `seedConfig` / `admin`     — same shape as `seed.ts` so specs in
 *     this file don't have to import from two places.
 *   - `twoUsers`                 — { userA, userB } spawned in parallel.
 *
 * Cleanup is robust: even if the test crashes mid-flight, the teardown
 * block deletes both auth users (which cascades to their rows via the
 * `on delete cascade` foreign keys in the schema).
 */

export type SeededUser = {
  email: string;
  password: string;
  userId: string;
};

type Fixtures = {
  seedConfig: SeedConfig;
  admin: SupabaseClient;
  twoUsers: { userA: SeededUser; userB: SeededUser };
};

async function provisionUser(admin: SupabaseClient): Promise<SeededUser> {
  // See fixtures/seed.ts for why the @hta-e2e.com domain is used.
  const email = `e2e+${Date.now()}+${Math.random().toString(36).slice(2, 10)}@hta-e2e.com`;
  const password = `E2E-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`provisionUser failed: ${error?.message ?? "unknown"}`);
  }
  return { email, password, userId: data.user.id };
}

export const test = base.extend<Fixtures>({
  /* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks, not React hooks. */
  seedConfig: async ({}, use, testInfo) => {
    const cfg = readSeedConfig();
    testInfo.skip(!cfg, SKIP_MESSAGE);
    await use(cfg!);
  },
  admin: async ({ seedConfig }, use) => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(seedConfig.supabaseUrl, seedConfig.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await use(client);
  },
  twoUsers: async ({ admin }, use) => {
    let userA: SeededUser | null = null;
    let userB: SeededUser | null = null;
    try {
      [userA, userB] = await Promise.all([
        provisionUser(admin),
        provisionUser(admin),
      ]);
      await use({ userA, userB });
    } finally {
      // Best-effort cleanup — failures here shouldn't fail the test. The
      // auth user delete cascades to profiles / training_blocks / etc.
      // via the schema's on-delete-cascade foreign keys.
      await Promise.all([
        userA ? admin.auth.admin.deleteUser(userA.userId).catch(() => {}) : null,
        userB ? admin.auth.admin.deleteUser(userB.userId).catch(() => {}) : null,
      ]);
    }
  },
  /* eslint-enable react-hooks/rules-of-hooks */
});

export { expect };
