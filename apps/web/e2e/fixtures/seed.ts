import { test as base, expect } from "@playwright/test";

/**
 * Seed-strategy contract for E2E tests.
 *
 * This repo does NOT yet have a wired-up test database for E2E. The
 * integration test layer with testcontainers Postgres mandated by
 * `AGENTS.md` is still pending (see `docs/knowledge/hybrid-training-app-plan.md`).
 *
 * Until that lands, each spec talks to a Supabase project. The fixture
 * reads either the `E2E_*` variables (when you want a dedicated test
 * project) OR falls back to the standard Next.js Supabase variables that
 * already exist in `apps/web/.env.local` for local dev:
 *
 *   - `PLAYWRIGHT_BASE_URL`              — defaults to http://localhost:3000
 *   - `E2E_SUPABASE_URL`                 — overrides; or fall back to
 *     `NEXT_PUBLIC_SUPABASE_URL`
 *   - `E2E_SUPABASE_SERVICE_ROLE_KEY`    — overrides; or fall back to
 *     `SUPABASE_SERVICE_ROLE_KEY`
 *   - `E2E_SUPABASE_ANON_KEY`            — overrides; or fall back to
 *     `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 *
 * If neither set is configured the test will SKIP with a clear message
 * rather than fail. That keeps CI green for forks / PRs that don't have
 * the secrets wired up.
 *
 * NOTE: when no separate test project exists, this fixture creates real
 * Supabase users in your dev/prod project. They're identified by an
 * `e2e-test-*@example.com` email pattern and auto-deleted on test
 * teardown. Avoid running these against a production project that holds
 * real-user data.
 *
 * When the testcontainers integration layer (Vitest + real Postgres)
 * lands, replace this fixture with one that boots the same container,
 * runs migrations and seeds a user — see `apps/web/e2e/README.md`.
 */

export type SeedConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
};

export function readSeedConfig(): SeedConfig | null {
  const supabaseUrl =
    process.env.E2E_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey =
    process.env.E2E_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return null;
  return { supabaseUrl, serviceRoleKey, anonKey };
}

export const SKIP_MESSAGE =
  "E2E seed env not configured. Set either E2E_SUPABASE_URL / " +
  "E2E_SUPABASE_SERVICE_ROLE_KEY / E2E_SUPABASE_ANON_KEY, or fall back to " +
  "the standard NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / " +
  "NEXT_PUBLIC_SUPABASE_ANON_KEY (already in apps/web/.env.local for local dev). " +
  "See apps/web/e2e/README.md for details.";

type SeededUser = {
  email: string;
  password: string;
  userId: string;
};

type Fixtures = {
  seedConfig: SeedConfig;
  freshUser: SeededUser;
};

/**
 * Playwright fixture that exposes the seed config and a freshly-created
 * test user. Both are wrapped in `test.skip` when env isn't configured,
 * so the surrounding `test(...)` block becomes a no-op skip.
 */
export const test = base.extend<Fixtures>({
  /* eslint-disable react-hooks/rules-of-hooks -- `use` here is the Playwright fixture callback, not a React hook. */
  seedConfig: async ({}, use, testInfo) => {
    const cfg = readSeedConfig();
    testInfo.skip(!cfg, SKIP_MESSAGE);
    await use(cfg!);
  },
  freshUser: async ({ seedConfig }, use) => {
    // Lazy import so the dependency only loads when env is wired.
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(seedConfig.supabaseUrl, seedConfig.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = `e2e+${Date.now()}+${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = `E2E-${Math.random().toString(36).slice(2)}-${Date.now()}`;

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Failed to create E2E user: ${error?.message ?? "unknown error"}`);
    }
    const userId = data.user.id;

    await use({ email, password, userId });

    // Best-effort cleanup. Failures here should not fail the test run.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  },
  /* eslint-enable react-hooks/rules-of-hooks */
});

export { expect };
