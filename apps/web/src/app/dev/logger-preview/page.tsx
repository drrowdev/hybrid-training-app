import { notFound } from "next/navigation";
import { LoggerPreview } from "./preview";

/**
 * Dev-only visual harness for the session logger.
 *
 * Renders the real `FocusStripLogger` with fixture props so the mobile
 * layout can be inspected and asserted without a database, auth or
 * network. It is the fixture the mobile Playwright spec drives, which is
 * what keeps the reachability guarantees (CTA in the thumb zone, 44px tap
 * targets, no clipped navigation) from silently regressing.
 *
 * 404s outside development.
 */
export default async function LoggerPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { variant } = await searchParams;
  return <LoggerPreview variant={variant ?? "rehab"} />;
}
