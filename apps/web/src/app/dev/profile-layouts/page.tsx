import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

/**
 * Dev-only gallery of candidate layouts for /app/settings/profile.
 *
 * Same gating contract as /dev/logger-preview: on in `next dev`, on in
 * CI when ENABLE_E2E_FIXTURES=1 (the e2e job serves a production
 * bundle), off in preview and production deploys. Evaluated per request
 * via force-dynamic so the 404 isn't baked in at build time.
 *
 * Renders hardcoded fixture state only — no DB reads, no server actions,
 * no writes. Delete this route once a layout is chosen and shipped.
 */
export const dynamic = "force-dynamic";

function fixturesEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.ENABLE_E2E_FIXTURES === "1"
  );
}

export default async function ProfileLayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (!fixturesEnabled()) notFound();
  const { variant } = await searchParams;
  return <Gallery variant={variant ?? "a"} />;
}
