import type { BrowserContext } from "@playwright/test";
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
