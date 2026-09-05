function credential(value: string | undefined, role: "anon" | "service"): boolean {
  if (!value || value !== value.trim() || /\s|[<>]/.test(value) ||
    /(?:^|[_-])(?:placeholder|replace|changeme|dummy|example|your|tests?)(?:[_-]|$)/i.test(value)) return false;
  const prefix = role === "anon" ? "sb_publishable_" : "sb_secret_";
  return (value.startsWith(prefix) && /^[A-Za-z0-9_-]{20,}$/.test(value.slice(prefix.length))) ||
    /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}$/.test(value);
}

export function isDedicatedSwimEnvironment(env: Record<string, string | undefined>): boolean {
  if (env.E2E_SWIM_NONPROD !== "1" || !credential(env.E2E_SUPABASE_ANON_KEY, "anon") ||
    !credential(env.E2E_SUPABASE_SERVICE_ROLE_KEY, "service") ||
    !env.SWIM_TEST_PROJECT_REF || !/^[a-z0-9-]+$/.test(env.SWIM_TEST_PROJECT_REF)) return false;
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
