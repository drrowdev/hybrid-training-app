"use client";
/**
 * MovementPicker — multi-select typeahead backed by
 * /api/movements/search. Used inside AddLimitationModal to let the
 * user pin a limitation to specific exercises ("avoid back squat,
 * substitute leg press").
 *
 * Network strategy: debounced fetch (180 ms) on input. Empty query
 * pre-fetches a small top-of-catalog slice so the dropdown isn't a
 * dead end on the first focus. The results card never paginates —
 * 20 results max — because the planner's movement catalog tops out
 * around 200 rows and the search filter is already substring-based.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { MovementRef } from "./types";

type SearchResult = {
  id: string;
  slug: string;
  display_name: string;
};

export type MovementPickerProps = {
  selected: MovementRef[];
  onChange: (next: MovementRef[]) => void;
};

const DEBOUNCE_MS = 180;

export function MovementPicker({
  selected,
  onChange,
}: MovementPickerProps): ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/movements/search?q=${encodeURIComponent(query)}&limit=20`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const json = (await res.json()) as { movements?: SearchResult[] };
        setResults(json.movements ?? []);
      } catch {
        // swallow — abort or transient network
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const selectedIds = useMemo(
    () => new Set(selected.map((m) => m.id)),
    [selected],
  );

  const add = (r: SearchResult) => {
    if (selectedIds.has(r.id)) return;
    onChange([
      ...selected,
      { id: r.id, slug: r.slug, displayName: r.display_name },
    ]);
    setQuery("");
  };

  const remove = (id: string) => {
    onChange(selected.filter((m) => m.id !== id));
  };

  const dropdownStyle: CSSProperties = {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    maxHeight: 240,
    overflowY: "auto",
    background: "var(--cp-panel-strong, var(--cp-surface))",
    border: "1px solid var(--cp-border)",
    borderRadius: 8,
    boxShadow: "var(--cp-shadow, 0 8px 24px rgba(0,0,0,0.25))",
    zIndex: 20,
  };

  const filtered = results.filter((r) => !selectedIds.has(r.id));

  return (
    <div data-testid="movement-picker" style={{ display: "grid", gap: 6 }}>
      {selected.length > 0 && (
        <div
          data-testid="movement-picker-chips"
          style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
        >
          {selected.map((m) => (
            <span
              key={m.id}
              data-testid={`movement-picker-chip-${m.slug}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                fontSize: 12,
                borderRadius: 999,
                background: "var(--cp-accent-soft, rgba(0,0,0,0.06))",
                color: "var(--cp-accent, var(--cp-text))",
                border: "1px solid var(--cp-border)",
              }}
            >
              {m.displayName}
              <button
                type="button"
                onClick={() => remove(m.id)}
                aria-label={`Remove ${m.displayName}`}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                  marginLeft: 2,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (blurTimer.current) window.clearTimeout(blurTimer.current);
            setFocused(true);
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setFocused(false), 120);
          }}
          placeholder="Search movements (e.g. squat)…"
          data-testid="movement-picker-input"
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--cp-border)",
            background: "var(--cp-surface-soft, transparent)",
            color: "var(--cp-text)",
            fontSize: 13,
          }}
        />
        {focused && (
          <div style={dropdownStyle} data-testid="movement-picker-dropdown">
            {loading && (
              <div style={{ padding: 10, fontSize: 12, color: "var(--cp-text-muted)" }}>
                Searching…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div style={{ padding: 10, fontSize: 12, color: "var(--cp-text-muted)" }}>
                No matches.
              </div>
            )}
            {!loading &&
              filtered.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  data-testid={`movement-picker-option-${r.slug}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(r);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    background: "transparent",
                    border: "none",
                    color: "var(--cp-text)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {r.display_name}
                  <span
                    className="mono"
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      color: "var(--cp-text-muted)",
                    }}
                  >
                    {r.slug}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
