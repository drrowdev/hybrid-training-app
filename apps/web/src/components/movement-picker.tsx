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
    <div ref={wrapRef} className="relative">
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
        className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm"
      />
      {selected && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-foreground/50 hover:text-foreground"
        >
          ✕
        </button>
      )}
      {open && !selected && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-foreground/15 bg-background shadow-lg">
          {loading && (
            <li className="px-3 py-2 text-xs text-foreground/50">Searching…</li>
          )}
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 text-xs text-foreground/50">
              No matches. Try &ldquo;squat&rdquo;, &ldquo;bench&rdquo;,
              &ldquo;run&rdquo;…
            </li>
          )}
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => pick(m)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-foreground/5"
              >
                <div className="font-medium">{m.display_name}</div>
                <div className="text-xs text-foreground/50">
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
