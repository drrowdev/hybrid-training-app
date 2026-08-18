"use client";

import { useId, type ReactNode } from "react";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "../AutoSaveStatus";

export type AutoSaveRadioOption<T extends string> = {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  testId?: string;
};

export type AutoSaveRadioGroupProps<T extends string> = {
  name: string;
  initial: T;
  options: ReadonlyArray<AutoSaveRadioOption<T>>;
  save: (value: T) => Promise<void>;
  /** Extra testid suffix for the wrapping status chip. */
  statusTestIdSuffix?: string;
};

/**
 * Radio-group auto-save field. Commits on every selection change.
 *
 * Styled as a quiet list rather than a stack of bordered boxes: the
 * selected row gets a soft accent wash and a left accent bar, the rest
 * stay flat. Nesting bordered rows inside a bordered card inside a
 * bordered group was the main source of visual noise on the old
 * settings page.
 */
export function AutoSaveRadioGroup<T extends string>({
  name,
  initial,
  options,
  save,
  statusTestIdSuffix,
}: AutoSaveRadioGroupProps<T>) {
  const groupId = useId();
  const { value, setValue, status, retry } = useAutoSave({
    initial,
    save,
    debounceMs: 0,
  });
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        role="radiogroup"
        aria-labelledby={groupId}
        style={{ display: "grid", gap: 2 }}
      >
        {options.map((opt) => {
          const sel = value === opt.value;
          return (
            <label
              key={opt.value}
              data-testid={opt.testId}
              data-selected={sel ? "true" : "false"}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: "pointer",
                borderRadius: 8,
                padding: "9px 12px",
                minHeight: 44,
                background: sel ? "var(--cp-accent-soft)" : "transparent",
                boxShadow: sel ? "inset 3px 0 0 var(--cp-accent)" : "none",
                transition: "background .14s",
              }}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={sel}
                onChange={() => setValue(opt.value)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: 14 }}>
                <span
                  style={{
                    fontWeight: sel ? 650 : 500,
                    color: sel ? "var(--cp-text)" : "var(--cp-text-soft)",
                  }}
                >
                  {opt.label}
                </span>
                {opt.hint != null && (
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      color: "var(--cp-text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {opt.hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix={statusTestIdSuffix}
      />
    </div>
  );
}
