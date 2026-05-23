"use client";

/**
 * Quick-jump command palette (Cmd-K / Ctrl-K).
 *
 * Pure React modal dialog opened by the provider. Owns:
 *   - the search input + ranked-result rendering,
 *   - keyboard navigation (↑/↓/Enter/Esc, wraps),
 *   - "Recent" group fallback from localStorage on empty query,
 *   - per-kind capping (5 / group).
 *
 * No external deps — ranking comes from `lib/cmd-k/matcher.ts`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  KIND_LABEL,
  KIND_ORDER,
  type PaletteIndices,
  type PaletteItem,
  type PaletteKind,
} from "@/lib/cmd-k/types";
import { rankItems, type MatchResult } from "@/lib/cmd-k/matcher";

const RECENT_KEY = "hta:cmdk:recent";
const RECENT_MAX = 5;
const GROUP_CAP = 5;

type FlatResult = MatchResult & { groupIndex: number };

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const cur = readRecent().filter((x) => x !== id);
    cur.unshift(id);
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(cur.slice(0, RECENT_MAX)),
    );
  } catch {
    // localStorage unavailable — recent history just won't persist.
  }
}

/**
 * Render the title with the matcher's highlight ranges in bold accent.
 */
function HighlightedTitle({
  title,
  ranges,
}: {
  title: string;
  ranges: Array<[number, number]>;
}) {
  if (ranges.length === 0) return <>{title}</>;
  const parts: Array<{ text: string; hl: boolean }> = [];
  let cursor = 0;
  for (const [s, e] of ranges) {
    if (s > cursor) parts.push({ text: title.slice(cursor, s), hl: false });
    parts.push({ text: title.slice(s, e), hl: true });
    cursor = e;
  }
  if (cursor < title.length) parts.push({ text: title.slice(cursor), hl: false });
  return (
    <>
      {parts.map((p, i) =>
        p.hl ? (
          <span key={i} style={{ color: "var(--cp-accent)", fontWeight: 700 }}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette({
  open,
  onClose,
  indices,
}: {
  open: boolean;
  onClose: () => void;
  indices: PaletteIndices;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  // Flatten all indices into a single lookup keyed by item id so
  // "recent" can rehydrate by id without re-fetching.
  const allItems = useMemo<PaletteItem[]>(
    () => [
      ...indices.pages,
      ...indices.sessions,
      ...indices.blocks,
      ...indices.movements,
      ...indices.events,
    ],
    [indices],
  );
  const byId = useMemo(() => {
    const m = new Map<string, PaletteItem>();
    for (const it of allItems) m.set(it.id, it);
    return m;
  }, [allItems]);

  // Reset query + selection every time the palette opens. Also stash
  // a focus-restore target so Esc returns focus to wherever the user
  // came from (e.g. a link in the sidebar).
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    /* eslint-disable react-hooks/set-state-in-effect -- reset transient palette state on each open */
    setQuery("");
    setSelected(0);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Defer focus so the dialog has mounted.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(id);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  /**
   * Compute the visible groups + the flat keyboard-navigation list.
   * Order matches KIND_ORDER so ↑/↓ tracks the rendered DOM order.
   */
  const { groups, flat } = useMemo(() => {
    const q = query.trim();

    // Empty query → "Recent" fallback, then the default page list so
    // the modal never looks empty.
    if (!q) {
      const recentItems: PaletteItem[] = [];
      if (typeof window !== "undefined") {
        for (const id of readRecent()) {
          const it = byId.get(id);
          if (it) recentItems.push(it);
        }
      }
      const groupsOut: Array<{
        kind: PaletteKind | "recent";
        label: string;
        items: MatchResult[];
      }> = [];
      if (recentItems.length > 0) {
        groupsOut.push({
          kind: "recent",
          label: "Recent",
          items: recentItems.map((item) => ({ item, score: 0, ranges: [] })),
        });
      }
      groupsOut.push({
        kind: "page",
        label: KIND_LABEL.page,
        items: indices.pages
          .slice(0, GROUP_CAP)
          .map((item) => ({ item, score: 0, ranges: [] })),
      });
      const flatOut: FlatResult[] = [];
      let gi = 0;
      for (const g of groupsOut) {
        for (const r of g.items) flatOut.push({ ...r, groupIndex: gi });
        gi++;
      }
      return { groups: groupsOut, flat: flatOut };
    }

    const ranked: Record<PaletteKind, MatchResult[]> = {
      page: rankItems(indices.pages, q).slice(0, GROUP_CAP),
      session: rankItems(indices.sessions, q).slice(0, GROUP_CAP),
      block: rankItems(indices.blocks, q).slice(0, GROUP_CAP),
      movement: rankItems(indices.movements, q).slice(0, GROUP_CAP),
      event: rankItems(indices.events, q).slice(0, GROUP_CAP),
    };

    const groupsOut: Array<{
      kind: PaletteKind | "recent";
      label: string;
      items: MatchResult[];
    }> = [];
    for (const k of KIND_ORDER) {
      if (ranked[k].length === 0) continue;
      groupsOut.push({ kind: k, label: KIND_LABEL[k], items: ranked[k] });
    }
    const flatOut: FlatResult[] = [];
    let gi = 0;
    for (const g of groupsOut) {
      for (const r of g.items) flatOut.push({ ...r, groupIndex: gi });
      gi++;
    }
    return { groups: groupsOut, flat: flatOut };
  }, [query, indices, byId]);

  // Clamp selection whenever the result list shrinks.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- clamp selection after result list resizes */
    if (flat.length === 0) {
      if (selected !== 0) setSelected(0);
      return;
    }
    if (selected >= flat.length) setSelected(flat.length - 1);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [flat.length, selected]);

  const navigate = (item: PaletteItem) => {
    pushRecent(item.id);
    onClose();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length === 0) return;
      setSelected((s) => (s + 1) % flat.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      setSelected((s) => (s - 1 + flat.length) % flat.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[selected];
      if (hit) navigate(hit.item);
    }
  };

  // Scroll the selected row into view when arrow keys move past the
  // viewport edge.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-cmdk-row="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);

  if (!open) return null;

  let runningIndex = 0;
  return (
    <div
      role="presentation"
      onClick={onClose}
      onKeyDown={onKeyDown}
      data-testid="cmdk-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
      }}
    >
      <div
        role="dialog"
        aria-label="Quick jump"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        data-testid="cmdk-dialog"
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--cp-bg-elevated)",
          border: "1px solid var(--cp-border)",
          borderRadius: 12,
          boxShadow: "var(--cp-shadow)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderBottom: "1px solid var(--cp-border)",
          }}
        >
          <span aria-hidden style={{ color: "var(--cp-text-muted)", fontSize: 16 }}>
            ⌕
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Search pages, movements, blocks, sessions…"
            aria-label="Search"
            data-testid="cmdk-input"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--cp-text)",
              fontSize: 15,
            }}
          />
          <kbd
            aria-hidden
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              border: "1px solid var(--cp-border)",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Quick jump results"
          style={{
            overflowY: "auto",
            padding: "6px 4px 8px",
            minHeight: 60,
          }}
        >
          {flat.length === 0 ? (
            <div
              data-testid="cmdk-empty"
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--cp-text-muted)",
                fontSize: 13,
              }}
            >
              No matches. Try a page, movement, block, or session.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} data-cmdk-group={g.label}>
                <div
                  style={{
                    padding: "8px 12px 4px",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--cp-text-muted)",
                  }}
                >
                  {g.label}
                </div>
                {g.items.map((m) => {
                  const idx = runningIndex++;
                  const active = idx === selected;
                  return (
                    <button
                      type="button"
                      key={m.item.id}
                      role="option"
                      aria-selected={active}
                      data-cmdk-row={idx}
                      data-testid={`cmdk-row-${m.item.id}`}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => navigate(m.item)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "9px 12px",
                        border: "none",
                        background: active ? "var(--cp-accent-soft)" : "transparent",
                        color: active ? "var(--cp-accent)" : "var(--cp-text)",
                        textAlign: "left",
                        cursor: "pointer",
                        borderRadius: 8,
                        fontSize: 14,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 18,
                          textAlign: "center",
                          color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
                        }}
                      >
                        {m.item.icon ?? "•"}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          <HighlightedTitle title={m.item.title} ranges={m.ranges} />
                        </span>
                        {m.item.subtitle && (
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {m.item.subtitle}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderTop: "1px solid var(--cp-border)",
            fontSize: 11,
            color: "var(--cp-text-muted)",
            background: "var(--cp-surface-soft)",
          }}
        >
          <span>↑ ↓ navigate · ↵ open · esc close</span>
          <span>{flat.length} result{flat.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
