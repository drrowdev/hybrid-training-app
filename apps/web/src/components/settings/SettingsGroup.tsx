"use client";

import { useEffect, useState, type ReactNode } from "react";

type Props = {
  /** Used as the element id for URL-hash deep linking (#profile etc.). */
  id: string;
  title: string;
  /** Small monospace chip rendered on the right of the summary, e.g. "drrowdev · metric". Optional. */
  summary?: string;
  testId?: string;
  /** Override default-collapsed behaviour for a specific group. */
  defaultOpen?: boolean;
  children: ReactNode;
};

export function SettingsGroup({
  id,
  title,
  summary,
  testId,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Auto-expand when the URL hash matches this group's id. Runs on
  // mount + hash-change so navigating from /app/settings#profile or
  // clicking an in-page hash link works.
  useEffect(() => {
    function syncFromHash() {
      if (typeof window === "undefined") return;
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === id) setOpen(true);
    }
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [id]);

  return (
    <details
      id={id}
      data-testid={testId}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface)",
        overflow: "hidden",
      }}
    >
      <summary
        className="settings-group-summary"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 16px",
          cursor: "pointer",
          listStyle: "none",
          userSelect: "none",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden="true"
            style={{
              fontSize: 12,
              color: "var(--cp-text-muted)",
              transition: "transform 150ms ease-out",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              display: "inline-block",
            }}
          >
            ▶
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--cp-text)" }}>
            {title}
          </span>
        </span>
        {summary && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textAlign: "right",
              maxWidth: "60%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {summary}
          </span>
        )}
      </summary>
      <div
        style={{
          padding: "0 16px 16px",
          borderTop: "1px solid var(--cp-border)",
          background: "var(--cp-bg-elevated)",
        }}
      >
        <div style={{ paddingTop: 16, display: "grid", gap: 18 }}>{children}</div>
      </div>
      {/* Cross-browser hide of the native disclosure marker. */}
      <style jsx>{`
        details > summary.settings-group-summary::-webkit-details-marker {
          display: none;
        }
        details > summary.settings-group-summary::marker {
          content: "";
        }
      `}</style>
    </details>
  );
}
