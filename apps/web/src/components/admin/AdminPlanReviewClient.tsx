"use client";

/**
 * Admin plan-review client: shows the generated markdown in a read-only
 * box with Copy-to-clipboard and Download-.md actions. The markdown is
 * built server-side and passed in; this component is purely the
 * export/clipboard surface.
 */
import { useState } from "react";

export function AdminPlanReviewClient({
  markdown,
  filename,
}: {
  markdown: string;
  filename: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={copy}
          className="cp-btn primary"
          data-testid="admin-review-copy"
          style={{ padding: "8px 14px" }}
        >
          {copied ? "Copied ✓" : "Copy markdown"}
        </button>
        <button
          type="button"
          onClick={download}
          className="cp-btn"
          data-testid="admin-review-download"
          style={{ padding: "8px 14px" }}
        >
          Download .md
        </button>
      </div>
      <textarea
        readOnly
        value={markdown}
        data-testid="admin-review-markdown"
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 480,
          fontFamily: "var(--cp-font-mono, monospace)",
          fontSize: 12.5,
          lineHeight: 1.5,
          padding: 14,
          borderRadius: 10,
          border: "1px solid var(--cp-border)",
          background: "var(--cp-surface)",
          color: "var(--cp-text)",
          resize: "vertical",
          whiteSpace: "pre",
          overflowWrap: "normal",
        }}
      />
    </div>
  );
}
