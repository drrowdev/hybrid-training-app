"use client";

/**
 * Equipment settings editor — bar weights (Olympic + trap/hex) plus
 * a small plate-inventory list. Stored canonically in kg; the suffix
 * label flips to lb when `profiles.units = 'imperial'` (display only).
 *
 * Inventory is serialised as JSON in a single hidden form input so
 * the matching server action doesn't have to walk indexed FormData
 * keys — see `updateEquipment` in `lib/settings/equipment-actions.ts`.
 */
import { useState } from "react";
import { updateEquipment } from "@/lib/settings/equipment-actions";

export type EquipmentSettingsProps = {
  initial: {
    barbellKg: number;
    trapBarKg: number;
    plateInventoryKg: Array<{ weight_kg: number; pair_count: number }>;
  };
  units: "metric" | "imperial";
};

type Row = { weightKg: string; pairCount: string };

const DEFAULT_NEW_ROW: Row = { weightKg: "", pairCount: "2" };

function rowsFromInventory(
  inventory: Array<{ weight_kg: number; pair_count: number }>,
): Row[] {
  return inventory.map((p) => ({
    weightKg: String(p.weight_kg),
    pairCount: String(p.pair_count),
  }));
}

export function EquipmentSettings({ initial, units }: EquipmentSettingsProps) {
  const [barbell, setBarbell] = useState(String(initial.barbellKg));
  const [trapBar, setTrapBar] = useState(String(initial.trapBarKg));
  const [rows, setRows] = useState<Row[]>(() => rowsFromInventory(initial.plateInventoryKg));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const suffix = units === "imperial" ? "lb" : "kg";

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const fd = new FormData();
      fd.set("barbellKg", barbell);
      fd.set("trapBarKg", trapBar);
      const inventory = rows
        .map((r) => ({
          weight_kg: Number(r.weightKg),
          pair_count: Number(r.pairCount),
        }))
        .filter(
          (p) => Number.isFinite(p.weight_kg) && p.weight_kg > 0 && p.pair_count > 0,
        );
      fd.set("plateInventoryJson", JSON.stringify(inventory));
      await updateEquipment(fd);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save equipment");
    } finally {
      setPending(false);
    }
  };

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const addRow = () => setRows((prev) => [...prev, { ...DEFAULT_NEW_ROW }]);

  return (
    <form
      onSubmit={onSubmit}
      data-testid="equipment-settings-form"
      style={{ display: "grid", gap: 16 }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--cp-text-muted)",
          lineHeight: 1.5,
        }}
      >
        We use these to show plate-per-side breakdowns when you&apos;re logging a
        barbell movement. Skip if you don&apos;t lift barbells.
      </p>

      <fieldset
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          border: "1px solid var(--cp-border)",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <legend
          style={{
            padding: "0 6px",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--cp-text-muted)",
          }}
        >
          Bar weights
        </legend>
        <BarInput
          label="Barbell"
          value={barbell}
          onChange={setBarbell}
          suffix={suffix}
          testId="equipment-barbell-kg"
        />
        <BarInput
          label="Trap bar"
          value={trapBar}
          onChange={setTrapBar}
          suffix={suffix}
          testId="equipment-trap-bar-kg"
        />
      </fieldset>

      <fieldset
        style={{
          display: "grid",
          gap: 8,
          border: "1px solid var(--cp-border)",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <legend
          style={{
            padding: "0 6px",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--cp-text-muted)",
          }}
        >
          Plate inventory
        </legend>
        <div
          data-testid="equipment-plate-rows"
          style={{ display: "grid", gap: 6 }}
        >
          {rows.length === 0 && (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "var(--cp-text-muted)",
                fontStyle: "italic",
              }}
            >
              No plates configured. Add at least one pair if you want plate
              breakdowns.
            </p>
          )}
          {rows.map((r, i) => (
            <div
              key={i}
              data-testid={`equipment-plate-row-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr auto",
                gap: 6,
                alignItems: "end",
              }}
            >
              <label
                style={{ display: "grid", gap: 2, fontSize: 11, color: "var(--cp-text-muted)" }}
              >
                Weight ({suffix})
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="60"
                  inputMode="decimal"
                  value={r.weightKg}
                  data-testid={`equipment-plate-weight-${i}`}
                  onChange={(e) => updateRow(i, { weightKg: e.target.value })}
                  style={inputStyle}
                />
              </label>
              <label
                style={{ display: "grid", gap: 2, fontSize: 11, color: "var(--cp-text-muted)" }}
              >
                Pairs
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="20"
                  inputMode="numeric"
                  value={r.pairCount}
                  data-testid={`equipment-plate-pairs-${i}`}
                  onChange={(e) => updateRow(i, { pairCount: e.target.value })}
                  style={inputStyle}
                />
              </label>
              <button
                type="button"
                onClick={() => removeRow(i)}
                data-testid={`equipment-plate-remove-${i}`}
                aria-label={`Remove ${r.weightKg || "row"} ${suffix} plates`}
                className="cp-btn"
                style={{ padding: "8px 10px", fontSize: 12 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="cp-btn"
          data-testid="equipment-plate-add"
          style={{ padding: "6px 10px", fontSize: 12, justifySelf: "start" }}
        >
          + Add plate weight
        </button>
      </fieldset>

      {error && (
        <div
          role="alert"
          data-testid="equipment-settings-error"
          style={{ fontSize: 12, color: "var(--cp-danger)" }}
        >
          {error}
        </div>
      )}
      {saved && !error && (
        <div
          role="status"
          data-testid="equipment-settings-saved"
          style={{ fontSize: 12, color: "var(--cp-success)" }}
        >
          Saved.
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="cp-btn primary"
        data-testid="equipment-settings-save"
        style={{ padding: "8px 14px", fontSize: 13, justifySelf: "start" }}
      >
        {pending ? "Saving…" : "Save equipment"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontFamily: "var(--cp-font-mono)",
  fontSize: 13,
};

function BarInput({
  label,
  value,
  onChange,
  suffix,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  testId: string;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--cp-text-muted)" }}>
      <span>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          step="0.25"
          min="1"
          max="60"
          inputMode="decimal"
          value={value}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, flex: "1 1 auto" }}
        />
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{suffix}</span>
      </div>
    </label>
  );
}
