"use client";

import { useId } from "react";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "../AutoSaveStatus";
import { FieldLabel, selectStyle } from "./primitives";

export type AutoSaveSelectOption = {
  value: string;
  label: string;
};

export type AutoSaveSelectProps = {
  label: string;
  initial: string;
  options: ReadonlyArray<AutoSaveSelectOption>;
  save: (value: string) => Promise<void>;
  testId?: string;
};

/**
 * Select-style auto-save field. Commits on every change — selects
 * are atomic, no debounce.
 */
export function AutoSaveSelect({
  label,
  initial,
  options,
  save,
  testId,
}: AutoSaveSelectProps) {
  const id = useId();
  const { value, setValue, status, retry } = useAutoSave({
    initial,
    save,
    debounceMs: 0,
  });
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        data-testid={testId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={selectStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix={testId}
      />
    </div>
  );
}
