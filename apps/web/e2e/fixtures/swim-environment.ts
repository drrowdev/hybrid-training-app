function credential(value: string | undefined, role: "anon" | "service"): boolean {
  if (!value || value !== value.trim() || /\s|[<>]/.test(value) ||
    /(?:^|[_-])(?:placeholder|replace|changeme|dummy|example|your|tests?)(?:[_-]|$)/i.test(value)) return false;
  const prefix = role === "anon" ? "sb_publishable_" : "sb_secret_";
  return (value.startsWith(prefix) && /^[A-Za-z0-9_-]{20,}$/.test(value.slice(prefix.length))) ||
    /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}$/.test(value);
}

const LOCAL_PROJECT_REF = "local";

/**
 * Narrow localhost-only mode for a disposable Supabase stack run on a CI
 * runner (e.g. the official Supabase CLI/Docker), never a hosted project.
 * Requires the literal `SWIM_TEST_PROJECT_REF=local` acknowledgement plus a
 * bare loopback `http:` origin, so it cannot be widened into accepting an
 * arbitrary URL.
 */
function isLocalSwimEnvironment(env: Record<string, string | undefined>): boolean {
  if (env.SWIM_TEST_PROJECT_REF !== LOCAL_PROJECT_REF) return false;
  const localOrigin = (value: string | undefined): string | null => {
    if (!value || !URL.canParse(value)) return null;
    const target = new URL(value);
    const isLoopback =
      target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "[::1]";
    return target.protocol === "http:" && isLoopback &&
      target.username === "" && target.password === "" &&
      target.pathname === "/" && target.search === "" && target.hash === "" ? target.origin : null;
  };
  const fixtureOrigin = localOrigin(env.E2E_SUPABASE_URL);
  return fixtureOrigin !== null &&
    (env.NEXT_PUBLIC_SUPABASE_URL === undefined || localOrigin(env.NEXT_PUBLIC_SUPABASE_URL) === fixtureOrigin);
}

export function isDedicatedSwimEnvironment(env: Record<string, string | undefined>): boolean {
  if (env.E2E_SWIM_NONPROD !== "1" || !credential(env.E2E_SUPABASE_ANON_KEY, "anon") ||
    !credential(env.E2E_SUPABASE_SERVICE_ROLE_KEY, "service") ||
    !env.SWIM_TEST_PROJECT_REF || !/^[a-z0-9-]+$/.test(env.SWIM_TEST_PROJECT_REF)) return false;
  if (env.E2E_SWIM_LOCAL === "1") return isLocalSwimEnvironment(env);
  const expected = `https://${env.SWIM_TEST_PROJECT_REF}.supabase.co`;
  const matches = (value: string | undefined) => value === expected || value === `${expected}/`;
  return matches(env.E2E_SUPABASE_URL) &&
    (env.NEXT_PUBLIC_SUPABASE_URL === undefined || matches(env.NEXT_PUBLIC_SUPABASE_URL));
}

export function swimE2EEnabled(env: Record<string, string | undefined>): boolean {
  if (env.E2E_SWIM_NONPROD === undefined) return false;
  if (!isDedicatedSwimEnvironment(env)) {
    throw new Error("Invalid swimming E2E configuration. Require SWIM_TEST_PROJECT_REF, a matching canonical HTTPS E2E_SUPABASE_URL, explicit non-placeholder E2E_SUPABASE_ANON_KEY and E2E_SUPABASE_SERVICE_ROLE_KEY, and E2E_SWIM_NONPROD=1.");
  }
  return true;
}
