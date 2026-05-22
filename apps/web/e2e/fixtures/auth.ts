import type { BrowserContext } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeedConfig } from "./seed";

/**
 * Programmatic sign-in for E2E tests.
 *
 * The login page renders an unlabeled `<input name="password" />` (no
 * `<label>`, no aria-label) so Playwright's `getByLabel(/password/i)`
 * can't see it. Rather than papering over that with a `getByPlaceholder`
 * walk through the UI (slow, brittle, doesn't test what we care about),
 * we sign the user in directly against Supabase and inject the resulting
 * cookies into the Playwright BrowserContext.
 *
 * We use `@supabase/ssr`'s `createServerClient` — the same client the
 * app's middleware uses — with an in-memory cookie store backed by a
 * Map. Calling `signInWithPassword` causes the library to write the
 * (chunked, base64-encoded) session cookies into that map. We then
 * forward every captured cookie to `context.addCookies(...)` so the
 * playwright-driven browser is authenticated for `baseURL`.
 *
 * This works for any baseURL — localhost, a deployed preview, etc. —
 * because the cookies are written for the app's domain (not Supabase's).
 */
export async function signInAs(
  context: BrowserContext,
  user: { email: string; password: string },
  seedConfig: SeedConfig,
  baseURL: string,
): Promise<void> {
  const { createServerClient } = await import("@supabase/ssr");

  // In-memory cookie jar. The @supabase/ssr client calls getAll/setAll
  // on every auth operation; we just need a Map-backed implementation.
  const jar = new Map<
    string,
    { name: string; value: string; options?: Record<string, unknown> }
  >();

  const supabase = createServerClient(seedConfig.supabaseUrl, seedConfig.anonKey, {
    cookies: {
      getAll() {
        return Array.from(jar.values()).map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const c of cookiesToSet) {
          if (c.value === "" || c.value == null) {
            jar.delete(c.name);
          } else {
            jar.set(c.name, c);
          }
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) {
    throw new Error(`signInAs: signInWithPassword failed: ${error.message}`);
  }

  const url = new URL(baseURL);
  // Playwright wants explicit cookies — strip the options the library
  // emits (maxAge / path / sameSite) and keep only what Playwright accepts.
  const playwrightCookies = Array.from(jar.values()).map((c) => {
    const opts = (c.options ?? {}) as {
      maxAge?: number;
      path?: string;
      sameSite?: "lax" | "strict" | "none";
      httpOnly?: boolean;
      secure?: boolean;
    };
    const expires =
      typeof opts.maxAge === "number"
        ? Math.floor(Date.now() / 1000) + opts.maxAge
        : -1;
    const sameSite =
      opts.sameSite === "strict"
        ? "Strict"
        : opts.sameSite === "none"
          ? "None"
          : "Lax";
    return {
      name: c.name,
      value: c.value,
      domain: url.hostname,
      path: opts.path ?? "/",
      expires,
      httpOnly: opts.httpOnly ?? true,
      secure: opts.secure ?? url.protocol === "https:",
      sameSite: sameSite as "Lax" | "Strict" | "None",
    };
  });

  if (playwrightCookies.length === 0) {
    throw new Error(
      "signInAs: no cookies captured from Supabase session — auth-helper out of date?",
    );
  }

  await context.addCookies(playwrightCookies);
}

// --- magic-link / signup-link helpers ---------------------------------
//
// These wrap Supabase's admin `generateLink` to mint the same action URL
// the user would receive in their inbox, so the auth E2E spec can test
// the real callback flow without depending on SMTP delivery.
//
// `generateLink` returns `properties.action_link` — the URL pointing at
// Supabase's `/auth/v1/verify` endpoint. Navigating to it verifies the
// token server-side and redirects to the configured `redirect_to`
// (defaulting to the Supabase project's Site URL). For PKCE-enabled
// projects (the @supabase/ssr default) the redirect lands on
// `<redirect_to>?code=...`, which the app's `/auth/callback` route
// exchanges for a session.

function makeAdminAuthClient(cfg: SeedConfig): Promise<SupabaseClient> {
  return import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  );
}

/**
 * Mint a magic-link URL for an already-confirmed user. Pass the
 * destination the callback should redirect to (default `/app`) so the
 * Supabase verify endpoint forwards the user there after exchanging
 * the code.
 */
export async function generateMagicLink(
  cfg: SeedConfig,
  email: string,
  baseURL: string,
  next: string = "/app",
): Promise<string> {
  const admin = await makeAdminAuthClient(cfg);
  const redirectTo = `${baseURL.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(next)}`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(
      `generateMagicLink failed: ${error?.message ?? "no action_link"}`,
    );
  }
  return data.properties.action_link;
}

/**
 * Mint a signup-confirmation link for an unconfirmed user. Use this to
 * exercise the signup → confirm → redirect flow without SMTP. The user
 * must NOT already exist; generateLink with type=signup creates them.
 */
export async function generateSignupLink(
  cfg: SeedConfig,
  email: string,
  password: string,
  baseURL: string,
  next: string = "/app",
): Promise<string> {
  const admin = await makeAdminAuthClient(cfg);
  const redirectTo = `${baseURL.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(next)}`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(
      `generateSignupLink failed: ${error?.message ?? "no action_link"}`,
    );
  }
  return data.properties.action_link;
}

/**
 * Look up an auth user by email via the admin listUsers endpoint.
 * Returns null if no match. Used by the signup-via-UI scenario where
 * the user is created by the action and we don't know the user id up
 * front. Paginates up to 5 pages of 200 to cover busy test projects.
 */
export async function findUserByEmail(
  cfg: SeedConfig,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const admin = await makeAdminAuthClient(cfg);
  const target = email.toLowerCase();
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`findUserByEmail: ${error.message}`);
    const users = data?.users ?? [];
    const match = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) return { id: match.id, email: match.email ?? email };
    if (users.length < 200) break;
  }
  return null;
}

/**
 * Best-effort cleanup helper for tests that create users via the UI
 * (where the spec doesn't get back a user id from the `freshUser`
 * fixture). Locates the user by email and deletes them; swallows
 * errors so test teardown stays robust.
 */
export async function deleteUserByEmail(
  cfg: SeedConfig,
  email: string,
): Promise<void> {
  try {
    const match = await findUserByEmail(cfg, email);
    if (!match) return;
    const admin = await makeAdminAuthClient(cfg);
    await admin.auth.admin.deleteUser(match.id);
  } catch {
    // Best-effort — never fail teardown.
  }
}
