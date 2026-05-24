"use client";

import { useEffect, useRef, useState } from "react";

export type MovementSearchResult = {
  id: string;
  slug: string;
  display_name: string;
  pattern: string;
  primary_region: string;
  primary_muscles: string[];
  equipment: string | null;
  is_compound: boolean;
};

/**
 * Movement autocomplete picker.
 * Calls /api/movements/search?q=…&pattern=…
 */
export function MovementPicker({
  name,
  patternFilter,
  placeholder = "Search movements…",
  onChange,
  initialDisplay,
}: {
  name: string;
  patternFilter?: string;
  placeholder?: string;
  onChange?: (m: MovementSearchResult | null) => void;
  initialDisplay?: string;
}) {
  const [query, setQuery] = useState(initialDisplay ?? "");
  const [results, setResults] = useState<MovementSearchResult[]>([]);
  const [selected, setSelected] = useState<MovementSearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (selected) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("limit", "15");
      if (patternFilter) params.set("pattern", patternFilter);
      try {
        const r = await fetch(`/api/movements/search?${params.toString()}`);
        const data = (await r.json()) as { movements: MovementSearchResult[] };
        if (!cancelled) setResults(data.movements ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, patternFilter, selected]);

  function pick(m: MovementSearchResult) {
    setSelected(m);
    setQuery(m.display_name);
    setOpen(false);
    onChange?.(m);
  }

  function clear() {
    setSelected(null);
    setQuery("");
    setResults([]);
    onChange?.(null);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <input
        type="text"
        value={query}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          if (selected) setSelected(null);
          setOpen(true);
        }}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: 13,
          borderRadius: 8,
          border: "1px solid var(--cp-border)",
          background: "var(--cp-surface)",
          color: "var(--cp-text)",
          outline: "none",
        }}
      />
      {selected && (
        <button
          type="button"
          onClick={clear}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            color: "var(--cp-text-muted)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      )}
      {open && !selected && (
        <ul
          style={{
            position: "absolute",
            zIndex: 50,
            marginTop: 4,
            maxHeight: "18rem",
            width: "100%",
            overflowY: "auto",
            background: "var(--cp-surface)",
            border: "1px solid var(--cp-border)",
            borderRadius: 8,
            boxShadow: "var(--cp-shadow, 0 8px 24px rgba(0,0,0,0.18))",
            padding: 0,
            margin: 0,
            listStyle: "none",
          }}
        >
          {loading && (
            <li style={{ padding: "8px 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
              Searching…
            </li>
          )}
          {!loading && results.length === 0 && (
            <li style={{ padding: "8px 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
              No matches. Try &ldquo;squat&rdquo;, &ldquo;bench&rdquo;,
              &ldquo;run&rdquo;…
            </li>
          )}
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => pick(m)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  fontSize: 13,
                  background: "transparent",
                  border: "none",
                  color: "var(--cp-text)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--cp-surface-soft)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <div style={{ fontWeight: 500 }}>{m.display_name}</div>
                <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                  {m.pattern} · {m.primary_region.replace(/_/g, " ")}
                  {m.primary_muscles.length > 0 &&
                    ` · ${m.primary_muscles.join(", ").replace(/_/g, " ")}`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
