"use client";

import { useId, type InputHTMLAttributes } from "react";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "../AutoSaveStatus";
import { FieldLabel, inputStyle } from "./primitives";

export type AutoSaveTextFieldProps = {
  label: string;
  initial: string;
  save: (value: string) => Promise<void>;
  /** Debounce window for typed input. Default 500ms. */
  debounceMs?: number;
  testId?: string;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown" | "id"
  >;
};

/**
 * Text-style auto-save field.
 *
 * - `onBlur` and `Enter` commit immediately.
 * - Typing schedules a debounced commit (default 500ms) so a user
 *   typing "300" doesn't trigger three saves.
 * - On error the field keeps the typed value (no rollback) and the
 *   inline status chip exposes Retry.
 */
export function AutoSaveTextField({
  label,
  initial,
  save,
  debounceMs = 500,
  testId,
  inputProps,
}: AutoSaveTextFieldProps) {
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
        type="text"
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
