/**
 * BackLink — the canonical "back to parent" navigation chrome that sits
 * above a page header.
 *
 * Replaces the ~80 hand-rolled back-links the app had accumulated (blue
 * `plan-nav-link`, `cp-btn`, bare anchors, inline-styled spans) with one
 * quiet, muted-until-hover treatment and consistent wording: a leading
 * "←" plus the parent surface name, e.g. `← Plan`, `← Settings`.
 *
 * Server-safe — styled via the `.cp-back-link` utility in globals.css.
 */
import Link from "next/link";
import type { ReactElement } from "react";

export type BackLinkProps = {
  href: string;
  /** Parent surface name — rendered after the arrow, e.g. "Plan" → "← Plan". */
  label: string;
};

export function BackLink({ href, label }: BackLinkProps): ReactElement {
  return (
    <Link href={href} className="cp-back-link" data-testid="back-link">
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  );
}
