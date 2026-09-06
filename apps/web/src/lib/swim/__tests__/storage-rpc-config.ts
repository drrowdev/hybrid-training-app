export type SwimRpcTestEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  projectRef: string;
};

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const candidate = trimmed.replace(/^sb_(?:publishable|secret)_/i, "");
  if (
    /^(?:<.*>|\$\{.*\}|[x*._-]+)$/i.test(candidate) ||
    /^(?:your|replace|paste|insert|enter|example|dummy|fake|test|placeholder|change.?me|todo|tbd|null|undefined)(?:[\s_-].*)?$/i.test(candidate)
  ) return undefined;
  return trimmed;
}

const LOCAL_PROJECT_REF = "local";

/**
 * Narrow localhost-only mode for a disposable Supabase stack run on a CI
 * runner (e.g. the official Supabase CLI/Docker), never a hosted project.
 * Requires the literal `SWIM_TEST_PROJECT_REF=local` acknowledgement plus a
 * bare loopback `http:` origin with no path/query/fragment/credentials, so
 * it cannot be widened into accepting an arbitrary URL.
 */
function requireLocalTarget(url: string, projectRef: string): URL {
  if (projectRef !== LOCAL_PROJECT_REF) {
    throw new Error(
      `Localhost-only swim RPC tests require SWIM_TEST_PROJECT_REF=${LOCAL_PROJECT_REF}.`,
    );
  }
  if (!URL.canParse(url)) {
    throw new Error("Invalid localhost swim RPC test target.");
  }
  const target = new URL(url);
  const isLoopback =
    target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "[::1]";
  if (
    target.protocol !== "http:" || !isLoopback ||
    target.username !== "" || target.password !== "" ||
    target.pathname !== "/" || target.search !== "" || target.hash !== ""
  ) {
    throw new Error("Localhost swim RPC test URL must be a bare loopback http origin.");
  }
  return target;
}

/** Explicit target and acknowledgement; never fall back to application secrets. */
export function getSwimRpcTestEnv(
  env: Record<string, string | undefined> = process.env,
): SwimRpcTestEnv | null {
  if (env.SWIM_RPC_TEST_NONPRODUCTION !== "true") return null;
  const url = configuredValue(env.SMOKE_SUPABASE_URL);
  const anonKey = configuredValue(env.SMOKE_SUPABASE_ANON_KEY);
  const serviceRoleKey = configuredValue(env.SMOKE_SUPABASE_SERVICE_ROLE_KEY);
  const projectRef = configuredValue(env.SWIM_TEST_PROJECT_REF);
  if (!url || !anonKey || !serviceRoleKey || !projectRef) {
    throw new Error(
      "Dedicated swim RPC tests require SWIM_TEST_PROJECT_REF and all three SMOKE_SUPABASE credentials.",
    );
  }
  if (env.SWIM_RPC_TEST_LOCAL === "true") {
    const target = requireLocalTarget(url, projectRef);
    return { url: target.origin, anonKey, serviceRoleKey, projectRef };
  }
  if (!/^[a-z0-9-]+$/.test(projectRef) || !URL.canParse(url)) {
    throw new Error("Invalid dedicated swim RPC test target.");
  }
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.hostname !== `${projectRef}.supabase.co` ||
    target.port !== "" || target.username !== "" || target.password !== "" ||
    target.pathname !== "/" || target.search !== "" || target.hash !== ""
  ) {
    throw new Error("Swim RPC test URL does not match the acknowledged SWIM_TEST_PROJECT_REF.");
  }
  return { url: target.origin, anonKey, serviceRoleKey, projectRef };
}
