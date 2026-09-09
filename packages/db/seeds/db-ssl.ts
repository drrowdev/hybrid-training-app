/**
 * Shared TLS-mode resolution for one-off seed/maintenance scripts that
 * connect with the `postgres` client directly (not through drizzle-kit,
 * which negotiates its own connection).
 *
 * Defaults preserved: no explicit `PGSSLMODE` still requires TLS
 * (`"require"`), matching every hosted target this repo has ever used.
 * `PGSSLMODE=verify-full` opts into certificate verification for an
 * explicitly selected isolated catalog target.
 *
 * `PGSSLMODE=disable` is accepted **only** when `DATABASE_URL` resolves to
 * a loopback host (`127.0.0.1`, `localhost`, `::1`) — a disposable local
 * Postgres for testing has no TLS listener at all. Any non-loopback host
 * still requires TLS even if `disable` is requested, so a hosted target can
 * never be downgraded by this option.
 */
export function resolveSeedSsl(
  databaseUrl: string,
  pgSslMode: string | undefined,
): boolean | "require" {
  if (pgSslMode === "verify-full") return true;
  if (pgSslMode === "disable" && isLoopbackDatabaseUrl(databaseUrl)) return false;
  return "require";
}

function isLoopbackDatabaseUrl(databaseUrl: string): boolean {
  if (!URL.canParse(databaseUrl)) return false;
  const { hostname } = new URL(databaseUrl);
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}
