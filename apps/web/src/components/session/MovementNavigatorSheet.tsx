"use client";

/**
 * Movement navigator — the "jump anywhere" surface for a live session.
 *
 * Replaces two things that used to sit above the fold and cost ~300px of
 * the first screen:
 *
 *   1. A row of section chips that only rendered when the day happened to
 *      contain rehab (`hasEmbeddedRehab`), so on an ordinary day there was
 *      no way to move between groups at all.
 *   2. A horizontally-scrolling movement queue — 725px of chips inside a
 *      358px window, with no peek, gradient or arrow to say so. On a
 *      five-movement day only two were reachable without a blind swipe.
 *
 * The sheet is opened from the dock, so it is reachable one-handed on a
 * tall phone, and it is always available regardless of the day's shape.
 * Linked work (antagonist supersets) is bracketed rather than listed as
 * unrelated rows, because splitting A1 from A2 misrepresents how the work
 * is actually performed.
 */

import { useEffect, useRef } from "react";
import type { MovementGroup } from "@/lib/sessions/movement-grouping";
import { movementGroupKey } from "@/lib/sessions/movement-grouping";
import { summariseGroupForHeader } from "@/lib/sessions/movement-summary";
import type { SupersetCardInfo } from "@/lib/sessions/superset-cards";
import type { FocusSectionKey } from "./FocusStripLogger";

export type NavigatorEntry = {
  group: MovementGroup;
  key: string;
  section: FocusSectionKey;
  done: number;
  total: number;
  settled: boolean;
  spec: string;
  superset: SupersetCardInfo | undefined;
};

const SECTION_ORDER: FocusSectionKey[] = [
  "rehab",
  "main",
  "supplemental",
  "accessories",
];

const SECTION_LABEL: Record<FocusSectionKey, string> = {
  rehab: "Rehab",
  main: "Main",
  supplemental: "Supplemental",
  accessories: "Accessories",
};

export function buildNavigatorEntries(opts: {
  groups: MovementGroup[];
  sectionFor: (g: MovementGroup) => FocusSectionKey;
  progressFor: (g: MovementGroup) => { done: number; total: number; settled: boolean };
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
  supersetByMovementId?: ReadonlyMap<string, SupersetCardInfo>;
}): NavigatorEntry[] {
  const { groups, sectionFor, progressFor, tmBySlug, oneRmBySlug } = opts;
  return groups.map((group) => {
    const tmKg = group.movementSlug ? tmBySlug[group.movementSlug] : undefined;
    const oneRmKg = group.movementSlug ? oneRmBySlug[group.movementSlug] : undefined;
    const { done, total, settled } = progressFor(group);
    return {
      group,
      key: movementGroupKey(group),
      section: sectionFor(group),
      done,
      total,
      settled,
      spec: summariseGroupForHeader(
        group,
        [],
        tmKg,
        oneRmKg != null && tmKg != null && Math.abs(tmKg - oneRmKg) < 0.001 ? "1RM" : "TM",
      ),
      superset: opts.supersetByMovementId?.get(group.movementId),
    };
  });
}

export function MovementNavigatorSheet({
  open,
  onClose,
  entries,
  activeKey,
  onPick,
  doneCount,
  totalCount,
}: {
  open: boolean;
  onClose: () => void;
  entries: NavigatorEntry[];
  activeKey: string;
  onPick: (key: string) => void;
  doneCount: number;
  totalCount: number;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Esc closes, and focus lands somewhere sane when it opens.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sections = SECTION_ORDER.map((key) => ({
    key,
    label: key === "rehab" && entries.some((e) => e.section !== "rehab")
      ? "Rehab · during warm-up"
      : SECTION_LABEL[key],
    items: entries.filter((e) => e.section === key),
  })).filter((s) => s.items.length > 0);

  return (
    <>
      <div
        className={`cp-nav-scrim${open ? " is-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`cp-nav-sheet${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Movements"
        aria-hidden={!open}
        data-testid="movement-navigator"
      >
        <div className="cp-nav-head">
          <div>
            <h2 className="cp-nav-title">Movements</h2>
            <span className="cp-nav-count mono">
              {doneCount}/{totalCount} logged
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="cp-nav-close"
            onClick={onClose}
            aria-label="Close movements"
            data-testid="movement-navigator-close"
          >
            ✕
          </button>
        </div>

        <div className="cp-nav-body">
          {sections.map((section) => {
            const drawn = new Set<string>();
            return (
              <div key={section.key}>
                <div className="cp-nav-section">{section.label}</div>
                {section.items.map((entry) => {
                  if (drawn.has(entry.key)) return null;
                  const partners = entry.superset
                    ? section.items.filter(
                        (e) => e.superset?.groupId === entry.superset?.groupId,
                      )
                    : [];
                  if (partners.length > 1) {
                    partners.forEach((p) => drawn.add(p.key));
                    return (
                      <div
                        key={`ss-${entry.superset!.groupId}`}
                        className="cp-nav-linked"
                        data-testid={`movement-navigator-superset-${entry.superset!.groupId}`}
                      >
                        <div className="cp-nav-linked-head">Superset — alternate</div>
                        {partners.map((p) => (
                          <NavRow
                            key={p.key}
                            entry={p}
                            active={p.key === activeKey}
                            onPick={onPick}
                          />
                        ))}
                      </div>
                    );
                  }
                  drawn.add(entry.key);
                  return (
                    <NavRow
                      key={entry.key}
                      entry={entry}
                      active={entry.key === activeKey}
                      onPick={onPick}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* The global tab bar is hidden while the dock is mounted, so leaving a
              live session has to be explicit and discoverable. It lives here
              rather than in the dock so it can never be mistaken for the log
              action. Nothing is lost: every set is already persisted (or queued
              in the offline outbox) the moment it is logged. */}
          <a
            className="cp-nav-leave"
            href="/app"
            data-testid="movement-navigator-leave"
          >
            <span className="cp-nav-leave-title">Leave workout</span>
            <span className="cp-nav-leave-sub">
              Your logged sets are saved — you can pick this up later
            </span>
          </a>
      </div>
    </div>
    </>
  );
}

function NavRow({
  entry,
  active,
  onPick,
}: {
  entry: NavigatorEntry;
  active: boolean;
  onPick: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className="cp-nav-item"
      data-testid={`movement-navigator-item-${entry.key}`}
      data-done={entry.settled ? "true" : "false"}
      aria-current={active}
      onClick={() => onPick(entry.key)}
    >
      {entry.superset && (
        <span className="cp-nav-slot mono">{entry.superset.slot}</span>
      )}
      <span className="cp-nav-mark" aria-hidden="true">
        {entry.settled ? "✓" : ""}
      </span>
      <span className="cp-nav-text">
        <span className="cp-nav-name">{entry.group.movementName}</span>
        {entry.spec && <span className="cp-nav-spec mono">{entry.spec}</span>}
      </span>
      <span className="cp-nav-prog mono">
        {entry.done}/{entry.total}
      </span>
    </button>
  );
}
