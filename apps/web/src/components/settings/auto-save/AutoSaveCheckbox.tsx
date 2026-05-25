"use client";

import { type ReactNode } from "react";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "../AutoSaveStatus";

export type AutoSaveCheckboxProps = {
  label: ReactNode;
  initial: boolean;
  save: (value: boolean) => Promise<void>;
  testId?: string;
};

/**
 * Checkbox-style auto-save field. Commits on every toggle.
 */
export function AutoSaveCheckbox({
  label,
  initial,
  save,
  testId,
}: AutoSaveCheckboxProps) {
  const { value, setValue, status, retry } = useAutoSave({
    initial,
    save,
    debounceMs: 0,
  });
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          data-testid={testId}
          checked={value}
          onChange={(e) => setValue(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span style={{ fontSize: 14 }}>{label}</span>
      </label>
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix={testId}
      />
    </div>
  );
}
