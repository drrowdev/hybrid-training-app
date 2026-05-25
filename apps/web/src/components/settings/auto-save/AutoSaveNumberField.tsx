"use client";

import { useId, type InputHTMLAttributes } from "react";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "../AutoSaveStatus";
import { FieldLabel, inputStyle } from "./primitives";

export type AutoSaveNumberFieldProps = {
  label: string;
  /** Stored as a string so the user can type intermediate states freely. */
  initial: string;
  save: (value: string) => Promise<void>;
  debounceMs?: number;
  testId?: string;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown" | "id"
  >;
};

/**
 * Number-style auto-save field. Same blur/Enter/debounce contract as
 * AutoSaveTextField but with `type="number"` semantics. The value is
 * kept as a string so partial entries ("0.", "1e") don't snap.
 */
export function AutoSaveNumberField({
  label,
  initial,
  save,
  debounceMs = 500,
  testId,
  inputProps,
}: AutoSaveNumberFieldProps) {
  const id = useId();
  const { value, setValue, flushNow, status, retry } = useAutoSave({
    initial,
    save,
    debounceMs,
  });
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="number"
        data-testid={testId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={flushNow}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            flushNow();
          }
        }}
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
