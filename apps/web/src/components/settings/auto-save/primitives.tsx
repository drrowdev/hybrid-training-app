"use client";

/**
 * Shared visual primitives used by every auto-save wrapper in this
 * folder. Kept tiny on purpose — the wrappers stay declarative.
 */
import type { CSSProperties, ReactNode } from "react";

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontSize: 14,
};

export const selectStyle: CSSProperties = {
  ...inputStyle,
  appearance: "auto",
};

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
    >
      {children}
    </label>
  );
}
