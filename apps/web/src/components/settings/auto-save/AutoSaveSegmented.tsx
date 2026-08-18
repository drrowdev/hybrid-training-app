"use client";

/**
 * Segmented (pill-row) auto-save field.
 *
 * Same commit contract as `AutoSaveRadioGroup` — every selection change
 * saves immediately — but rendered as a horizontal pill row instead of a
 * stacked list. Used for the short, mutually-exclusive choices on the
 * training-profile page (units, strength standards) where a vertical
 * radio list wasted a card's worth of height.
 *
 * Native radios are kept (visually hidden inside the labels) so arrow-key
 * navigation, focus handling and radiogroup semantics come for free; the
 * pills are only styling. Each label carries `data-selected` so tests can
 * assert selection the same way they do for `AutoSaveRadioGroup`.
 */
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "../AutoSaveStatus";

export type AutoSaveSegmentedOption<T extends string> = {
  value: T;
  label: string;
  testId?: string;
};

export type AutoSaveSegmentedProps<T extends string> = {
  name: string;
  /** Accessible name for the group — rendered visually hidden. */
  legend: string;
  /** `""` renders with nothing selected (e.g. an undeclared value). */
  initial: T | "";
  options: ReadonlyArray<AutoSaveSegmentedOption<T>>;
  save: (value: T) => Promise<void>;
  /** Test id suffix for the status chip. */
  statusTestIdSuffix?: string;
};

export function AutoSaveSegmented<T extends string>({
  name,
  legend,
  initial,
  options,
  save,
  statusTestIdSuffix,
}: AutoSaveSegmentedProps<T>) {
  const { value, setValue, status, retry } = useAutoSave({
    initial,
    save: (v: string) => save(v as T),
    debounceMs: 0,
  });
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend className="sr-only">{legend}</legend>
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 4,
            border: "1px solid var(--cp-border)",
            borderRadius: 999,
            background: "var(--cp-bg-elevated)",
          }}
        >
          {options.map((opt) => {
            const sel = value === opt.value;
            return (
              <label
                key={opt.value}
                data-testid={opt.testId}
                data-selected={sel ? "true" : "false"}
                style={{
                  flex: "1 1 0",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 36,
                  padding: "8px 12px",
                  borderRadius: 999,
                  cursor: "pointer",
                  textAlign: "center",
                  background: sel ? "var(--cp-accent)" : "transparent",
                  color: sel ? "var(--cp-accent-fg)" : "var(--cp-text-soft)",
                  transition: "background .14s, color .14s",
                }}
              >
                <input
                  type="radio"
                  name={name}
                  value={opt.value}
                  checked={sel}
                  onChange={() => setValue(opt.value)}
                  className="sr-only"
                />
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: sel ? 650 : 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {opt.label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix={statusTestIdSuffix}
      />
    </div>
  );
}
