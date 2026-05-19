import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components and the browser bundle.
 * Reads only the public env vars — the anon (publishable) key is safe to
 * ship to the client because Row Level Security enforces access control.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
