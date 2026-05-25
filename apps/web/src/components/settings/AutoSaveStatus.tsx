"use client";

/**
 * Inline status chip shown next to (or below) an auto-saving field.
 *
 * Reserves a fixed 14px tall slot so transitioning between
 * idle/saving/saved/error never reflows surrounding layout. On error
 * the chip exposes a Retry button that delegates back to the hook
 * via the `onRetry` prop.
 */
import type { AutoSaveStatus as Status } from "@/lib/settings/use-auto-save";

export type AutoSaveStatusProps = {
  status: Status;
  onRetry?: () => void;
  /** Optional test id suffix so multiple chips on one page are addressable. */
  testIdSuffix?: string;
  /** Accessible message for screen-reader on error. Defaults to "Couldn't save". */
  errorLabel?: string;
};

export function AutoSaveStatus({
  status,
  onRetry,
  testIdSuffix,
  errorLabel = "Couldn't save",
}: AutoSaveStatusProps) {
  const testId = testIdSuffix
    ? `autosave-status-${testIdSuffix}`
    : "autosave-status";
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-status={status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "var(--cp-text-muted)",
        minHeight: 14,
        opacity: status === "idle" ? 0 : 1,
        transition: "opacity 200ms ease-out",
      }}
    >
      {status === "saving" && <span>Saving…</span>}
      {status === "saved" && (
        <span style={{ color: "var(--cp-success)" }}>Saved</span>
      )}
      {status === "error" && (
        <>
          <span style={{ color: "var(--cp-danger)" }}>{errorLabel}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              data-testid={
                testIdSuffix
                  ? `autosave-retry-${testIdSuffix}`
                  : "autosave-retry"
              }
              style={{
                fontSize: 11,
                color: "var(--cp-link, var(--cp-text))",
                textDecoration: "underline",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Retry
            </button>
          )}
        </>
      )}
    </span>
  );
}
