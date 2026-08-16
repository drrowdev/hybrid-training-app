import { notFound } from "next/navigation";
import { LoggerPreview } from "./preview";

/**
 * Dev-only visual harness for the session logger.
 *
 * Renders the real `FocusStripLogger` with fixture props so the mobile layout
 * can be inspected and asserted without a database, auth or network. It is the
 * fixture the mobile Playwright spec drives, which is what keeps the
 * reachability guarantees (CTA in the thumb zone, 44px tap targets, no clipped
 * navigation) from silently regressing.
 *
 * Availability is opt-in, and off by default:
 *
 *   - `next dev`  → always on, for local inspection.
 *   - CI          → on, because the e2e job builds and serves a PRODUCTION
 *                   bundle (`pnpm start`); gating on NODE_ENV alone made this
 *                   route 404 there and took the whole spec with it.
 *   - Deploys     → off. Vercel never sets `ENABLE_E2E_FIXTURES`, so the route
 *                   404s in preview and production.
 *
 * The page renders hardcoded fixture data and stubbed actions — it reads no
 * user data and writes nothing — but it stays off in production regardless.
 */
/**
 * Evaluated per request, not at module load: this page must be able to be
 * enabled by the environment the server was STARTED with, not the one it was
 * built in. Without `force-dynamic` Next prerenders it at build time and bakes
 * in the 404 — which is exactly how the first attempt at this failed in CI.
 */
export const dynamic = "force-dynamic";

function fixturesEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.ENABLE_E2E_FIXTURES === "1"
  );
}

export default async function LoggerPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (!fixturesEnabled()) notFound();
  const { variant } = await searchParams;
  return <LoggerPreview variant={variant ?? "rehab"} />;
}
