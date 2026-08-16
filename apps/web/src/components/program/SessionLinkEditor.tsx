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
  linkSummary,
  linksIncludeMainLift,
  removeLink,
  selectableMovements,
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

  const selectable = selectableMovements(movements, links);
  const lockedNote = movements.find((m) => m.lockedReason)?.lockedReason;
  const showWarning = linksIncludeMainLift(links, movements);

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
            return (
              <div
                key={link.id}
                data-testid={`session-link-${link.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderLeft: `2px solid ${accent}`,
                  paddingLeft: 8,
                  minHeight: 32,
                }}
              >
                <span style={{ display: "grid", gap: 2, minWidth: 0, flex: 1 }}>
                  <b
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: accent,
                    }}
                  >
                    {link.name}
                  </b>
                  <small
                    style={{
                      fontSize: 11,
                      color: "var(--dim, #afb8a8)",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {linkSummary(link, movements)}
                  </small>
                </span>
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
            );
          })}
        </div>
      )}

      {selectable.length >= 2 && (
        <details>
          <summary
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
            {links.length > 0 ? "+ Link more lifts" : "+ Link lifts"}
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
              disabled={!canCreateLink(selected, links)}
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
                cursor: canCreateLink(selected, links) ? "pointer" : "not-allowed",
                opacity: canCreateLink(selected, links) ? 1 : 0.4,
              }}
            >
              {selected.length >= 2
                ? `Link as ${defaultLinkName(selected.length).toLowerCase()}`
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
