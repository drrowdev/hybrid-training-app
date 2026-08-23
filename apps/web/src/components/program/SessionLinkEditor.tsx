"use client";

/**
 * Session-link CREATOR — pick two or more lifts in one strength slot and run
 * them back-to-back as a superset / tri-set / giant set.
 *
 * This component used to also RENDER each existing link, member by member,
 * below the program-slot list. That is now drawn on the rows themselves (see
 * `slotLinkBadges` + `LinkBadge` in ProgramPicker): stating the link in both
 * places said the same thing twice, and the panel version listed stored
 * members, so a two-pick superset containing the AB Triad displayed as four
 * rows. Reorder and Unlink moved to the rows with the label. What is left here
 * is the one thing the rows cannot express — creating a link that does not
 * exist yet.
 *
 * Two rules are enforced here rather than left to the engine:
 *
 *   - Movements the template ALREADY links (the AB Triad) are never offered. A
 *     prescription item carries at most one circuit, so an overlapping user
 *     link would collide; the engine drops such links as a backstop, but a
 *     control you can click that then silently does nothing is worse than one
 *     you cannot click.
 *   - Linking a main lift warns but never blocks (DC-K4 — override and warn).
 *     Long rests between heavy sets are what let you hold the prescribed
 *     percentage, so the trade-off is surfaced, not decided for the lifter.
 *
 * All editing logic lives in `./session-link-editing` so it can be tested
 * directly — this file is deliberately just presentation.
 */
import { useState } from "react";
import { defaultLinkName, type SessionLink } from "@/lib/platform/session-links";
import {
  addLink,
  canCreateLink,
  linksIncludeMainLift,
  selectableMovements,
  selectedStations,
  toggleSelection,
  type LinkableMovement,
} from "./session-link-editing";

export type { LinkableMovement };

export interface SessionLinkEditorProps {
  seriesKey: string;
  movements: LinkableMovement[];
  links: SessionLink[];
  onChange: (seriesKey: string, links: SessionLink[]) => void;
}

export function SessionLinkEditor({
  seriesKey,
  movements,
  links,
  onChange,
}: SessionLinkEditorProps) {
  const [selected, setSelected] = useState<string[]>([]);
  // `<details>` owns its open state in the DOM, so the summary's +/− marker has
  // to be mirrored into React or it stays "+" while the panel is open.
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectable = selectableMovements(movements, links);
  const lockedNote = movements.find((m) => m.lockedReason)?.lockedReason;
  const showWarning = linksIncludeMainLift(links, movements);

  if (movements.length < 2) return null;

  return (
    <div data-testid={`session-links-${seriesKey}`} style={{ marginTop: 10 }}>
      {selectable.length >= 2 && (
        <details
          open={pickerOpen}
          onToggle={(event) => setPickerOpen(event.currentTarget.open)}
        >
          <summary
            data-testid={`link-picker-toggle-${seriesKey}`}
            style={{
              border: "1px solid var(--line2, #384230)",
              borderRadius: "var(--wradius, 6px)",
              background: "var(--bg, #0f1310)",
              color: "var(--dim, #afb8a8)",
              padding: "8px 10px",
              fontSize: 11,
              cursor: "pointer",
              listStyle: "none",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "1em",
                fontWeight: 700,
              }}
            >
              {pickerOpen ? "\u2212" : "+"}
            </span>
            {links.length > 0 ? "Superset more lifts" : "Superset lifts"}
          </summary>
          <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
            {selectable.map((m) => (
              <label
                key={m.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  minHeight: 32,
                  cursor: "pointer",
                  color: "var(--dim, #afb8a8)",
                }}
              >
                <input
                  type="checkbox"
                  data-testid={`link-pick-${seriesKey}-${m.key}`}
                  checked={selected.includes(m.key)}
                  onChange={() =>
                    setSelected((current) => toggleSelection(current, m.key))
                  }
                />
                <span style={{ overflowWrap: "anywhere" }}>{m.label}</span>
              </label>
            ))}
            {lockedNote && (
              <p
                data-testid={`link-locked-note-${seriesKey}`}
                style={{
                  margin: "2px 0 0",
                  fontSize: 10.5,
                  color: "var(--muted, #79836f)",
                }}
              >
                {lockedNote}
              </p>
            )}
            <button
              type="button"
              data-testid={`link-create-${seriesKey}`}
              disabled={!canCreateLink(selected, links, movements)}
              onClick={() => {
                onChange(seriesKey, addLink(links, movements, selected));
                setSelected([]);
              }}
              style={{
                marginTop: 4,
                border: "1px solid var(--accent, #8fb39b)",
                borderRadius: "var(--wradius, 6px)",
                background: "transparent",
                color: "var(--accent, #8fb39b)",
                padding: "7px 10px",
                fontSize: 11,
                cursor: canCreateLink(selected, links, movements)
                  ? "pointer"
                  : "not-allowed",
                opacity: canCreateLink(selected, links, movements) ? 1 : 0.4,
              }}
            >
              {selected.length >= 2
                ? `Link as ${defaultLinkName(
                    selectedStations(movements, selected).length,
                  ).toLowerCase()}`
                : "Select 2 or more"}
            </button>
          </div>
        </details>
      )}

      {showWarning && (
        <p
          data-testid={`link-main-warning-${seriesKey}`}
          style={{
            margin: "8px 0 0",
            padding: "8px 10px",
            border: "1px solid var(--warn, #c99a5b)",
            borderLeftWidth: 2,
            borderRadius: "var(--wradius, 6px)",
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--dim, #afb8a8)",
          }}
        >
          <b style={{ color: "var(--warn, #c99a5b)" }}>
            Main lift in a superset.
          </b>{" "}
          Long rests between heavy sets are what let you hold the prescribed
          percentage. This will shorten the session, but expect the last rounds
          to feel harder — back off a set if bar speed drops. We&rsquo;ll keep it
          as you set it.
        </p>
      )}
    </div>
  );
}
