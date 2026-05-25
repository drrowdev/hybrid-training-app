"use client";

import { useId, type InputHTMLAttributes } from "react";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "../AutoSaveStatus";
import { FieldLabel, inputStyle } from "./primitives";

export type AutoSaveDateFieldProps = {
  label: string;
  initial: string;
  save: (value: string) => Promise<void>;
  testId?: string;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange" | "id"
  >;
};

/**
 * Date-input auto-save field. Native date pickers commit on each
 * adjustment so we save on change with no debounce.
 */
export function AutoSaveDateField({
  label,
  initial,
  save,
  testId,
  inputProps,
}: AutoSaveDateFieldProps) {
  const id = useId();
  const { value, setValue, status, retry } = useAutoSave({
    initial,
    save,
    debounceMs: 0,
  });
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="date"
        data-testid={testId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={inputStyle}
        {...inputProps}
      />
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix={testId}
      />
    </div>
  );
}
