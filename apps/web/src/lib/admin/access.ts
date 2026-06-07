/**
 * Admin gating for internal-only tooling (e.g. the plan-review export).
 *
 * There is no role column in the DB; admin status is an env-driven
 * allowlist of email addresses. `ADMIN_EMAILS` is a comma-separated list
 * (e.g. "me@example.com, other@example.com"). When unset, NOBODY is an
 * admin — the safe default, so admin routes are inert in any environment
 * that hasn't explicitly opted in.
 *
 * Matching is case-insensitive and trims whitespace. Email is read from
 * the authenticated Supabase user (`user.email`).
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const raw = process.env.ADMIN_EMAILS ?? "";
  const allow = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (allow.length === 0) return false;
  const e = (email ?? "").trim().toLowerCase();
  return e.length > 0 && allow.includes(e);
}
