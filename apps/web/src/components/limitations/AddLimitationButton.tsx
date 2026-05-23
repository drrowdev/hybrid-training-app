"use client";
/**
 * Small client wrapper around the "Add a limitation" trigger button
 * plus the modal. Lives at the top of /app/recovery/injuries.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import { AddLimitationModal } from "./AddLimitationModal";

export function AddLimitationButton({
  variant = "primary",
  label = "Add a limitation",
}: {
  variant?: "primary" | "ghost";
  label?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const isPrimary = variant === "primary";
  return (
    <>
      <button
        type="button"
        data-testid="add-limitation-button"
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: isPrimary
            ? "1px solid var(--cp-accent, var(--cp-text))"
            : "1px solid var(--cp-border)",
          background: isPrimary
            ? "var(--cp-accent, var(--cp-text))"
            : "transparent",
          color: isPrimary
            ? "var(--cp-accent-fg, var(--cp-bg))"
            : "var(--cp-text)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
      <AddLimitationModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
