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
      <div role="radiogroup" aria-labelledby={groupId} style={{ display: "grid", gap: 8 }}>
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
                gap: 12,
                cursor: "pointer",
                border: "1px solid var(--cp-border)",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={sel}
                onChange={() => setValue(opt.value)}
                style={{ marginTop: 4 }}
              />
              <span style={{ fontSize: 14 }}>
                {opt.label}
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
