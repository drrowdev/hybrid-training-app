"use client";

/**
 * Rich equipment-inventory editor.
 *
 * Owns the entire `Equipment` form state. Selecting a preset
 * overwrites the form fields with that preset's values; any
 * subsequent edit auto-flips the badge back to "Custom" — the
 * preset choice is remembered but the data is the user's.
 *
 * All weights stored in kg; the suffix label flips to lb at the
 * render boundary when `profiles.units = 'imperial'` (display only).
 *
 * Submission goes through `updateEquipmentV2`, which validates the
 * payload via `parseEquipment` and writes the JSONB blob to
 * `profiles.equipment`.
 */
import { useState } from "react";
import { updateEquipmentV2 } from "@/lib/settings/equipment-actions";
import {
  type Equipment,
  type EquipmentPreset,
  type MachineType,
  type CardioMachineType,
  ALL_MACHINES,
  ALL_CARDIO,
  MACHINE_LABEL,
  CARDIO_LABEL,
} from "@/lib/settings/equipment-schema";
import {
  PRESET_BY_KEY,
  PRESET_LABEL,
} from "@/lib/settings/equipment-presets";

type Props = {
  initial: Equipment;
  units: "metric" | "imperial";
};

const PRESET_ORDER: EquipmentPreset[] = [
  "commercial_gym",
  "home_gym",
  "bodyweight_only",
  "travel_hotel",
  "custom",
];

function clonePreset(preset: EquipmentPreset): Equipment {
  return structuredClone(PRESET_BY_KEY[preset]);
}

export function EquipmentEditor({ initial, units }: Props) {
  const [equipment, setEquipment] = useState<Equipment>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const suffix = units === "imperial" ? "lb" : "kg";

  /**
   * Apply a mutation and mark the preset "custom" if it isn't
   * already (the user took ownership of the data). The literal
   * "custom" preset doesn't flip.
   */
  const mutate = (fn: (draft: Equipment) => Equipment) => {
    setEquipment((prev) => {
      const next = fn(structuredClone(prev));
      if (next.preset !== "custom") next.preset = "custom";
      return next;
    });
    setSaved(false);
  };

  const applyPreset = (key: EquipmentPreset) => {
    setEquipment(clonePreset(key));
    setSaved(false);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const fd = new FormData();
      fd.set("equipmentJson", JSON.stringify(equipment));
      await updateEquipmentV2(fd);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save equipment");
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      data-testid="equipment-editor-form"
      data-preset={equipment.preset}
      style={{ display: "grid", gap: 20 }}
    >
      <PresetRow active={equipment.preset} onPick={applyPreset} />

      <BarsSection
        bars={equipment.bars}
        suffix={suffix}
        onChange={(bars) => mutate((d) => ({ ...d, bars }))}
      />

      <PlatesSection
        plates={equipment.plates}
        suffix={suffix}
        onChange={(plates) => mutate((d) => ({ ...d, plates }))}
      />

      <DumbbellsSection
        dumbbells={equipment.dumbbells}
        suffix={suffix}
        onChange={(dumbbells) => mutate((d) => ({ ...d, dumbbells }))}
      />

      <KettlebellsSection
        kettlebells={equipment.kettlebells}
        suffix={suffix}
        onChange={(kettlebells) => mutate((d) => ({ ...d, kettlebells }))}
      />

      <MachinesSection
        machines={equipment.machines}
        onChange={(machines) => mutate((d) => ({ ...d, machines }))}
      />

      <CardioSection
        cardio={equipment.cardio}
        onChange={(cardio) => mutate((d) => ({ ...d, cardio }))}
      />

      <AccessoriesSection
        accessories={equipment.accessories}
        suffix={suffix}
        onChange={(accessories) => mutate((d) => ({ ...d, accessories }))}
      />

      {error && (
        <div
          role="alert"
          data-testid="equipment-editor-error"
          style={{ fontSize: 12, color: "var(--cp-danger)" }}
        >
          {error}
        </div>
      )}
      {saved && !error && (
        <div
          role="status"
          data-testid="equipment-editor-saved"
          style={{ fontSize: 12, color: "var(--cp-success)" }}
        >
          Saved.
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="cp-btn primary"
        data-testid="equipment-editor-save"
        style={{ padding: "8px 14px", fontSize: 13, justifySelf: "start" }}
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

// ─── Preset picker ────────────────────────────────────────────────

function PresetRow({
  active,
  onPick,
}: {
  active: EquipmentPreset;
  onPick: (key: EquipmentPreset) => void;
}) {
  return (
    <fieldset style={fieldsetStyle}>
      <Legend>Pick a starting point</Legend>
      <div
        data-testid="equipment-preset-row"
        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      >
        {PRESET_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            data-testid={`equipment-preset-${key}`}
            data-active={active === key ? "true" : "false"}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${
                active === key ? "var(--cp-accent)" : "var(--cp-border)"
              }`,
              background:
                active === key ? "var(--cp-accent-soft)" : "var(--cp-surface)",
              color:
                active === key ? "var(--cp-accent)" : "var(--cp-text)",
              fontSize: 12,
              fontWeight: active === key ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {PRESET_LABEL[key]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// ─── Bars ─────────────────────────────────────────────────────────

function BarsSection({
  bars,
  suffix,
  onChange,
}: {
  bars: Equipment["bars"];
  suffix: string;
  onChange: (next: Equipment["bars"]) => void;
}) {
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-bars">
      <Legend>Bars</Legend>
      <BarKgRow
        label="Olympic barbell"
        valueKg={bars.barbellKg}
        suffix={suffix}
        testIdRoot="equipment-bar-olympic"
        onChange={(v) => onChange({ ...bars, barbellKg: v ?? 0 })}
        allowDisable={false}
      />
      <BarKgRow
        label="Trap / hex bar"
        valueKg={bars.trapBarKg}
        suffix={suffix}
        testIdRoot="equipment-bar-trap"
        onChange={(v) => onChange({ ...bars, trapBarKg: v })}
        allowDisable
      />
      <BarKgRow
        label="Safety squat bar"
        valueKg={bars.safetyBarKg}
        suffix={suffix}
        testIdRoot="equipment-bar-safety"
        onChange={(v) => onChange({ ...bars, safetyBarKg: v })}
        allowDisable
      />
    </fieldset>
  );
}

function BarKgRow({
  label,
  valueKg,
  suffix,
  testIdRoot,
  onChange,
  allowDisable,
}: {
  label: string;
  valueKg: number | null;
  suffix: string;
  testIdRoot: string;
  onChange: (next: number | null) => void;
  allowDisable: boolean;
}) {
  const present = valueKg != null;
  return (
    <div
      data-testid={testIdRoot}
      data-present={present ? "true" : "false"}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(160px, 1fr) auto auto",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 13, color: "var(--cp-text)" }}>{label}</span>
      {present ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="number"
              step="0.5"
              min="0"
              max="60"
              inputMode="decimal"
              value={valueKg ?? 0}
              data-testid={`${testIdRoot}-kg`}
              onChange={(e) => onChange(Number(e.target.value))}
              style={{ ...inputStyle, width: 80 }}
            />
            <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{suffix}</span>
          </div>
          {allowDisable && (
            <button
              type="button"
              onClick={() => onChange(null)}
              data-testid={`${testIdRoot}-remove`}
              className="cp-btn"
              style={{ padding: "6px 8px", fontSize: 11 }}
            >
              ×
            </button>
          )}
          {!allowDisable && <span />}
        </>
      ) : (
        <>
          <span
            style={{ fontSize: 12, color: "var(--cp-text-muted)", fontStyle: "italic" }}
          >
            not available
          </span>
          <button
            type="button"
            onClick={() => onChange(25)}
            data-testid={`${testIdRoot}-add`}
            className="cp-btn"
            style={{ padding: "6px 8px", fontSize: 11 }}
          >
            Add
          </button>
        </>
      )}
    </div>
  );
}

// ─── Plates ───────────────────────────────────────────────────────

const COMMON_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];

function PlatesSection({
  plates,
  suffix,
  onChange,
}: {
  plates: number[];
  suffix: string;
  onChange: (next: number[]) => void;
}) {
  const [customWeight, setCustomWeight] = useState("");
  const toggle = (w: number) => {
    const present = plates.includes(w);
    if (present) {
      onChange(plates.filter((p) => p !== w));
    } else {
      onChange([...plates, w].sort((a, b) => b - a));
    }
  };
  const addCustom = () => {
    const n = Number(customWeight);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return;
    if (plates.includes(n)) return;
    onChange([...plates, n].sort((a, b) => b - a));
    setCustomWeight("");
  };
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-plates">
      <Legend>Plates</Legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {COMMON_PLATES.map((w) => (
          <ToggleChip
            key={w}
            label={`${w} ${suffix}`}
            active={plates.includes(w)}
            onToggle={() => toggle(w)}
            testId={`equipment-plate-${String(w).replace(".", "_")}`}
          />
        ))}
        {plates
          .filter((p) => !COMMON_PLATES.includes(p))
          .map((p) => (
            <ToggleChip
              key={`extra-${p}`}
              label={`${p} ${suffix}`}
              active
              onToggle={() => toggle(p)}
              testId={`equipment-plate-extra-${String(p).replace(".", "_")}`}
            />
          ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input
          type="number"
          step="0.25"
          min="0.25"
          max="100"
          inputMode="decimal"
          placeholder={`Other (${suffix})`}
          value={customWeight}
          onChange={(e) => setCustomWeight(e.target.value)}
          data-testid="equipment-plate-custom-input"
          style={{ ...inputStyle, width: 120 }}
        />
        <button
          type="button"
          onClick={addCustom}
          className="cp-btn"
          data-testid="equipment-plate-custom-add"
          style={{ padding: "6px 10px", fontSize: 12 }}
        >
          + Add
        </button>
      </div>
    </fieldset>
  );
}

// ─── Dumbbells ────────────────────────────────────────────────────

function DumbbellsSection({
  dumbbells,
  suffix,
  onChange,
}: {
  dumbbells: Equipment["dumbbells"];
  suffix: string;
  onChange: (next: Equipment["dumbbells"]) => void;
}) {
  const available = dumbbells != null;
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-dumbbells">
      <Legend>Dumbbells</Legend>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 13 }}>Available?</span>
        <RadioPill
          label="No"
          active={!available}
          onClick={() => onChange(null)}
          testId="equipment-dumbbells-no"
        />
        <RadioPill
          label="Yes"
          active={available}
          onClick={() =>
            onChange(dumbbells ?? { minKg: 5, maxKg: 50, stepKg: 2.5 })
          }
          testId="equipment-dumbbells-yes"
        />
      </div>
      {available && (
        <div
          data-testid="equipment-dumbbells-range"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 10,
            alignItems: "center",
          }}
        >
          <RangeInput
            label="From"
            value={dumbbells.minKg}
            suffix={suffix}
            testId="equipment-dumbbells-min"
            onChange={(v) => onChange({ ...dumbbells, minKg: v })}
          />
          <RangeInput
            label="to"
            value={dumbbells.maxKg}
            suffix={suffix}
            testId="equipment-dumbbells-max"
            onChange={(v) => onChange({ ...dumbbells, maxKg: v })}
          />
          <RangeInput
            label="in"
            value={dumbbells.stepKg}
            suffix={`${suffix} steps`}
            testId="equipment-dumbbells-step"
            onChange={(v) => onChange({ ...dumbbells, stepKg: v })}
          />
        </div>
      )}
    </fieldset>
  );
}

// ─── Kettlebells ──────────────────────────────────────────────────

const COMMON_KBS = [8, 12, 16, 20, 24, 28, 32, 40];

function KettlebellsSection({
  kettlebells,
  suffix,
  onChange,
}: {
  kettlebells: number[];
  suffix: string;
  onChange: (next: number[]) => void;
}) {
  const [customWeight, setCustomWeight] = useState("");
  const toggle = (w: number) => {
    if (kettlebells.includes(w)) {
      onChange(kettlebells.filter((k) => k !== w));
    } else {
      onChange([...kettlebells, w].sort((a, b) => a - b));
    }
  };
  const addCustom = () => {
    const n = Number(customWeight);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return;
    if (kettlebells.includes(n)) return;
    onChange([...kettlebells, n].sort((a, b) => a - b));
    setCustomWeight("");
  };
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-kettlebells">
      <Legend>Kettlebells</Legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {COMMON_KBS.map((w) => (
          <ToggleChip
            key={w}
            label={`${w} ${suffix}`}
            active={kettlebells.includes(w)}
            onToggle={() => toggle(w)}
            testId={`equipment-kb-${w}`}
          />
        ))}
        {kettlebells
          .filter((k) => !COMMON_KBS.includes(k))
          .map((k) => (
            <ToggleChip
              key={`extra-${k}`}
              label={`${k} ${suffix}`}
              active
              onToggle={() => toggle(k)}
              testId={`equipment-kb-extra-${k}`}
            />
          ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input
          type="number"
          step="0.5"
          min="1"
          max="100"
          inputMode="decimal"
          placeholder={`Other (${suffix})`}
          value={customWeight}
          onChange={(e) => setCustomWeight(e.target.value)}
          data-testid="equipment-kb-custom-input"
          style={{ ...inputStyle, width: 120 }}
        />
        <button
          type="button"
          onClick={addCustom}
          className="cp-btn"
          data-testid="equipment-kb-custom-add"
          style={{ padding: "6px 10px", fontSize: 12 }}
        >
          + Add
        </button>
      </div>
    </fieldset>
  );
}

// ─── Machines ─────────────────────────────────────────────────────

function MachinesSection({
  machines,
  onChange,
}: {
  machines: MachineType[];
  onChange: (next: MachineType[]) => void;
}) {
  const toggle = (m: MachineType) => {
    if (machines.includes(m)) onChange(machines.filter((x) => x !== m));
    else onChange([...machines, m]);
  };
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-machines">
      <Legend>Machines</Legend>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 6,
        }}
      >
        {ALL_MACHINES.map((m) => (
          <ToggleChip
            key={m}
            label={MACHINE_LABEL[m]}
            active={machines.includes(m)}
            onToggle={() => toggle(m)}
            testId={`equipment-machine-${m}`}
            align="start"
          />
        ))}
      </div>
    </fieldset>
  );
}

// ─── Cardio ───────────────────────────────────────────────────────

function CardioSection({
  cardio,
  onChange,
}: {
  cardio: CardioMachineType[];
  onChange: (next: CardioMachineType[]) => void;
}) {
  const toggle = (m: CardioMachineType) => {
    if (cardio.includes(m)) onChange(cardio.filter((x) => x !== m));
    else onChange([...cardio, m]);
  };
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-cardio">
      <Legend>Cardio equipment</Legend>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 6,
        }}
      >
        {ALL_CARDIO.map((m) => (
          <ToggleChip
            key={m}
            label={CARDIO_LABEL[m]}
            active={cardio.includes(m)}
            onToggle={() => toggle(m)}
            testId={`equipment-cardio-${m}`}
            align="start"
          />
        ))}
      </div>
    </fieldset>
  );
}

// ─── Accessories ──────────────────────────────────────────────────

function AccessoriesSection({
  accessories,
  suffix,
  onChange,
}: {
  accessories: Equipment["accessories"];
  suffix: string;
  onChange: (next: Equipment["accessories"]) => void;
}) {
  const toggleVest = () => {
    if (accessories.weightedVest) {
      onChange({ ...accessories, weightedVest: false });
    } else {
      onChange({ ...accessories, weightedVest: { kg: 10 } });
    }
  };
  const toggleSandbag = () => {
    if (accessories.sandbag) {
      onChange({ ...accessories, sandbag: false });
    } else {
      onChange({ ...accessories, sandbag: { kg: 20 } });
    }
  };
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-accessories">
      <Legend>Accessories</Legend>
      <div style={{ display: "grid", gap: 6 }}>
        <WeightedAccessoryRow
          label="Weighted vest"
          present={Boolean(accessories.weightedVest)}
          kg={accessories.weightedVest ? accessories.weightedVest.kg : 10}
          suffix={suffix}
          testIdRoot="equipment-accessory-vest"
          onToggle={toggleVest}
          onChangeKg={(v) =>
            onChange({ ...accessories, weightedVest: { kg: v } })
          }
        />
        <WeightedAccessoryRow
          label="Sandbag"
          present={Boolean(accessories.sandbag)}
          kg={accessories.sandbag ? accessories.sandbag.kg : 20}
          suffix={suffix}
          testIdRoot="equipment-accessory-sandbag"
          onToggle={toggleSandbag}
          onChangeKg={(v) => onChange({ ...accessories, sandbag: { kg: v } })}
        />
        <BoolRow
          label="Dip belt"
          value={accessories.dipBelt}
          testId="equipment-accessory-dipBelt"
          onChange={(v) => onChange({ ...accessories, dipBelt: v })}
        />
        <BoolRow
          label="Bands"
          value={accessories.bands}
          testId="equipment-accessory-bands"
          onChange={(v) => onChange({ ...accessories, bands: v })}
        />
        <BoolRow
          label="Pull-up bar"
          value={accessories.pullUpBar}
          testId="equipment-accessory-pullUpBar"
          onChange={(v) => onChange({ ...accessories, pullUpBar: v })}
        />
        <BoolRow
          label="Gymnastic rings"
          value={accessories.rings}
          testId="equipment-accessory-rings"
          onChange={(v) => onChange({ ...accessories, rings: v })}
        />
      </div>
    </fieldset>
  );
}

function WeightedAccessoryRow({
  label,
  present,
  kg,
  suffix,
  testIdRoot,
  onToggle,
  onChangeKg,
}: {
  label: string;
  present: boolean;
  kg: number;
  suffix: string;
  testIdRoot: string;
  onToggle: () => void;
  onChangeKg: (v: number) => void;
}) {
  return (
    <div
      data-testid={testIdRoot}
      data-present={present ? "true" : "false"}
      style={{ display: "flex", alignItems: "center", gap: 10 }}
    >
      <button
        type="button"
        onClick={onToggle}
        data-testid={`${testIdRoot}-toggle`}
        aria-pressed={present}
        style={checkboxButtonStyle(present)}
      >
        {present ? "✓" : ""}
      </button>
      <span style={{ fontSize: 13, minWidth: 110 }}>{label}</span>
      {present && (
        <>
          <input
            type="number"
            step="0.5"
            min="0"
            max="200"
            inputMode="decimal"
            value={kg}
            data-testid={`${testIdRoot}-kg`}
            onChange={(e) => onChangeKg(Number(e.target.value))}
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{suffix}</span>
        </>
      )}
    </div>
  );
}

function BoolRow({
  label,
  value,
  testId,
  onChange,
}: {
  label: string;
  value: boolean;
  testId: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      data-testid={testId}
      aria-pressed={value}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: 0,
        background: "transparent",
        border: 0,
        color: "var(--cp-text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={checkboxButtonStyle(value)}>{value ? "✓" : ""}</span>
      <span style={{ fontSize: 13 }}>{label}</span>
    </button>
  );
}

// ─── Shared primitives ────────────────────────────────────────────

function ToggleChip({
  label,
  active,
  onToggle,
  testId,
  align,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  testId: string;
  align?: "start" | "center";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: align === "start" ? "flex-start" : "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--cp-accent)" : "var(--cp-border)"}`,
        background: active ? "var(--cp-accent-soft)" : "var(--cp-surface)",
        color: active ? "var(--cp-accent)" : "var(--cp-text)",
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
      }}
    >
      <span aria-hidden style={{ width: 12, display: "inline-block" }}>
        {active ? "✓" : ""}
      </span>
      <span>{label}</span>
    </button>
  );
}

function RadioPill({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--cp-accent)" : "var(--cp-border)"}`,
        background: active ? "var(--cp-accent-soft)" : "var(--cp-surface)",
        color: active ? "var(--cp-accent)" : "var(--cp-text)",
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function RangeInput({
  label,
  value,
  suffix,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  testId: string;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{label}</span>
      <input
        type="number"
        step="0.5"
        min="0"
        max="200"
        inputMode="decimal"
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputStyle, width: 80 }}
      />
      <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{suffix}</span>
    </label>
  );
}

function Legend({ children }: { children: React.ReactNode }) {
  return (
    <legend
      style={{
        padding: "0 6px",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--cp-text-muted)",
      }}
    >
      {children}
    </legend>
  );
}

const fieldsetStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  border: "1px solid var(--cp-border)",
  borderRadius: 12,
  padding: 12,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontFamily: "var(--cp-font-mono)",
  fontSize: 13,
};

function checkboxButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 6,
    border: `1px solid ${active ? "var(--cp-accent)" : "var(--cp-border)"}`,
    background: active ? "var(--cp-accent-soft)" : "var(--cp-surface)",
    color: active ? "var(--cp-accent)" : "var(--cp-text)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  };
}
