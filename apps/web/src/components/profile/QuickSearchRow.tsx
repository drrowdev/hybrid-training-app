"use client";

/**
 * QuickSearchRow — mobile-friendly entry point that opens the
 * command palette via `useCommandPalette()`. Lives on /app/profile
 * (the "More" destination on mobile) because the desktop top-bar
 * search button is hidden < 768 px.
 */

import { useCommandPalette } from "@/components/cmd-k/CommandPaletteProvider";

export function QuickSearchRow() {
  const palette = useCommandPalette();
  return (
    <button
      type="button"
      data-testid="profile-quick-search"
      onClick={() => palette.open()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface-soft, var(--cp-surface))",
        color: "var(--cp-text-muted)",
        fontSize: 14,
        font: "inherit",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <svg
        aria-hidden
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span>Quick search…</span>
    </button>
  );
}
