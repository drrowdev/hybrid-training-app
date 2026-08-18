"use client";

/**
 * How a session link is DRAWN on the program-slot rows it applies to.
 *
 * Links used to be stated twice — once as a badge here, once as a member list
 * in a panel below the slot. That said the same thing in two places, and the
 * panel listed stored members rather than picked stations, so a two-pick
 * superset containing the AB Triad displayed as a giant set of four. The rows
 * won: that is where the lifter reads the session. So the label, the reorder
 * controls and Unlink all live on the row, and `SessionLinkEditor` was reduced
 * to the one thing rows cannot express — creating a link that does not exist.
 *
 * Split out of ProgramPicker so the assembled markup can actually be tested:
 * the wizard rows are behind interactive state (customise mode + an expanded
 * phase) that a static render cannot reach.
 */
import type { SessionLink } from "@/lib/platform/session-links";
import {
  moveStation,
  removeLink,
  type LinkableMovement,
  type SlotLinkBadge,
} from "./session-link-editing";

/**
 * Row class for a program-slot row that belongs to a session link.
 *
 * The accent rail is drawn per row rather than by wrapping the members in a
 * container: the rows are siblings in one grid, and wrapping them would break
 * the shared column tracks that keep PROGRAM SLOT / EXERCISE aligned.
 *
 * `base` differs by caller — Activation rows carry `activationMovementRow`,
 * custom-builder rows are styled by a descendant selector and carry none — so
 * it is passed in rather than assumed. Both still get the same caps, which is
 * what tells the eye where a link starts and stops.
 */
export function rowLinkClass(
  styles: Record<string, string>,
  badge: SlotLinkBadge | undefined,
  base: string = styles.activationMovementRow ?? "",
): string {
  if (!badge) return base;
  return [
    base,
    styles.linkedRow,
    badge.hasMainLift ? styles.linkedRowWarn : "",
    badge.station === 1 && badge.isStationStart ? styles.linkedRowStart : "",
    badge.isLinkEnd ? styles.linkedRowEnd : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export interface LinkBadgeProps {
  styles: Record<string, string>;
  badge: SlotLinkBadge | undefined;
  /**
   * The four control props travel together: without all of them the badge is
   * read-only. Custom-builder rows that cannot yet edit links pass none.
   */
  links?: readonly SessionLink[];
  movements?: readonly LinkableMovement[];
  seriesKey?: string;
  onChange?: (seriesKey: string, links: SessionLink[]) => void;
}

/**
 * "SUPERSET A1", plus the link's own controls, on the row it applies to.
 *
 * Only the first row of a station is labelled. The AB Triad's three slots are
 * ONE pick, so numbering them A2/A3/A4 is exactly what made a two-station
 * superset read as a giant set; its trailing slots say "same station" instead.
 */
export function LinkBadge({
  styles,
  badge,
  links,
  movements,
  seriesKey,
  onChange,
}: LinkBadgeProps) {
  if (!badge) return null;
  if (!badge.isStationStart) {
    return (
      <span className={styles.linkContinuation}>{"\u2514 same station"}</span>
    );
  }
  const editable =
    links != null && movements != null && seriesKey != null && onChange != null;
  const station = badge.station - 1;
  return (
    <span
      className={[
        styles.linkBadge,
        badge.hasMainLift ? styles.linkBadgeWarn : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`row-link-badge-${badge.linkId}-${badge.station}`}
    >
      <code>A{badge.station}</code>
      {badge.linkName}
      {editable && (
        <span className={styles.linkRowActions}>
          <button
            type="button"
            aria-label={`Move ${badge.linkName} station ${badge.station} earlier`}
            data-testid={`row-link-up-${badge.linkId}-${badge.station}`}
            disabled={station === 0}
            onClick={() =>
              onChange(
                seriesKey,
                moveStation(links, badge.linkId, station, -1, movements),
              )
            }
          >
            {"\u2191"}
          </button>
          <button
            type="button"
            aria-label={`Move ${badge.linkName} station ${badge.station} later`}
            data-testid={`row-link-down-${badge.linkId}-${badge.station}`}
            disabled={station === badge.stationCount - 1}
            onClick={() =>
              onChange(
                seriesKey,
                moveStation(links, badge.linkId, station, 1, movements),
              )
            }
          >
            {"\u2193"}
          </button>
          {/* One Unlink per link, on its first station — repeating it on every
              member would imply each row could be detached on its own. */}
          {badge.station === 1 && (
            <button
              type="button"
              className={styles.linkUnlink}
              aria-label={`Unlink ${badge.linkName}`}
              data-testid={`row-link-unlink-${badge.linkId}`}
              onClick={() => onChange(seriesKey, removeLink(links, badge.linkId))}
            >
              Unlink
            </button>
          )}
        </span>
      )}
    </span>
  );
}
