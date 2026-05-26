import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Reads/writes the session cookie via `next/headers` so RLS sees
 * the signed-in user on every server-side query.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies — middleware handles refresh.
          }
        },
      },
    },
  );
}

/**
 * Per-request cached `supabase.auth.getUser()` for server components,
 * server actions, route handlers, and any helper that runs inside a
 * React Server Components render. Audit F9 measured `getUser()` being
 * called 2–3× per page load (middleware + layout + page), each a
 * 100–300ms POST to Supabase GoTrue (not a cached `fetch`, so Next
 * won't dedupe). `React.cache` memoises within the same request scope,
 * so layout + page + library helpers share one call.
 *
 * Middleware stays on its own client — it runs before request scope is
 * established (different runtime context, can't use `React.cache`) and
 * is required separately for token refresh.
 *
 * Returns the same `{ data: { user }, error }` shape Supabase does so
 * existing call sites can destructure unchanged.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});

/**
 * Service-role client. **Never** import this into a Client Component.
 * Bypasses RLS. Used only for the account-delete endpoint and
 * server-side admin work.
 */
export function createAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
