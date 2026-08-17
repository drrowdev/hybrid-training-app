"use client";

/**
 * Session-link editor — pick two or more lifts in one strength slot and run them
 * back-to-back as a superset / tri-set / giant set.
 *
 * Replaces the block-level "Superset accessories" checkbox, which auto-paired
 * anatomical antagonists and could never touch a main lift or express what the
 * lifter actually wanted. Here the link is explicit: the lifter chooses the
 * members and the order.
 *
 * Two rules are enforced here rather than left to the engine:
 *
 *   - Movements the template ALREADY links (the AB Triad) are never offered. A
 *     prescription item carries at most one circuit, so an overlapping user link
 *     would collide; the engine drops such links as a backstop, but a control
 *     you can click that then silently does nothing is worse than one you cannot
 *     click.
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
  linkHasMainLift,
  linksIncludeMainLift,
  moveMember,
  removeLink,
  selectableMovements,
  selectedStations,
  slotLabels,
  toggleSelection,
  type LinkableMovement,
} from "./session-link-editing";

export type { LinkableMovement };

/** Compact ± control for reordering a link's members. */
function moveButtonStyle(disabled: boolean) {
  return {
    flex: "none" as const,
    width: 26,
    height: 26,
    lineHeight: "1",
    border: "1px solid var(--line2, #384230)",
    borderRadius: 4,
    background: "transparent",
    color: "var(--dim, #afb8a8)",
    fontSize: 11,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.3 : 1,
  };
}

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
  const byKey = slotLabels(movements);

  if (movements.length < 2) return null;

  return (
    <div data-testid={`session-links-${seriesKey}`} style={{ marginTop: 10 }}>
      {links.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          {links.map((link) => {
            const hasMain = linkHasMainLift(link, movements);
            const accent = hasMain
              ? "var(--warn, #c99a5b)"
              : "var(--accent, #8fb39b)";
            const lastLabel =
              byKey.get(link.members[link.members.length - 1]!) ??
              link.members[link.members.length - 1]!;
            return (
              <div
                key={link.id}
                data-testid={`session-link-${link.id}`}
                style={{
                  borderLeft: `2px solid ${accent}`,
                  paddingLeft: 8,
                  paddingBottom: 2,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 26,
                  }}
                >
                  <b
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: accent,
                      flex: 1,
                    }}
                  >
                    {link.name}
                  </b>
                  <button
                    type="button"
                    aria-label={`Unlink ${link.name}`}
                    onClick={() => onChange(seriesKey, removeLink(links, link.id))}
                    style={{
                      border: 0,
                      background: "transparent",
                      color: "var(--warn, #c99a5b)",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    Unlink
                  </button>
                </div>
                {link.members.map((member, index) => {
                  const label = byKey.get(member) ?? member;
                  const isFirst = index === 0;
                  const isLast = index === link.members.length - 1;
                  return (
                    <div
                      key={member}
                      data-testid={`link-member-${link.id}-${index}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minHeight: 32,
                        fontSize: 11.5,
                        color: "var(--dim, #afb8a8)",
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          flex: "none",
                          fontSize: 9.5,
                          color: accent,
                          minWidth: 18,
                        }}
                      >
                        A{index + 1}
                      </span>
                      <span
                        style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}
                      >
                        {label}
                      </span>
                      <button
                        type="button"
                        aria-label={`Move ${label} earlier`}
                        data-testid={`link-move-up-${link.id}-${index}`}
                        disabled={isFirst}
                        onClick={() =>
                          onChange(seriesKey, moveMember(links, link.id, index, -1))
                        }
                        style={moveButtonStyle(isFirst)}
                      >
                        {"\u2191"}
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${label} later`}
                        data-testid={`link-move-down-${link.id}-${index}`}
                        disabled={isLast}
                        onClick={() =>
                          onChange(seriesKey, moveMember(links, link.id, index, 1))
                        }
                        style={moveButtonStyle(isLast)}
                      >
                        {"\u2193"}
                      </button>
                    </div>
                  );
                })}
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 10,
                    color: "var(--muted, #79836f)",
                  }}
                >
                  {`Rest after ${lastLabel}, then start the next round.`}
                </p>
              </div>
            );
          })}
        </div>
      )}

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
            {links.length > 0 ? "Link more lifts" : "Link lifts"}
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
