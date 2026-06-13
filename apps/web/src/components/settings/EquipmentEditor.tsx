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
import { useCallback, useRef, useState } from "react";
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
  PRESET_HINT,
} from "@/lib/settings/equipment-presets";
import { useAutoSave } from "@/lib/settings/use-auto-save";
import { AutoSaveStatus } from "./AutoSaveStatus";
import { EditableKgChips } from "./EditableKgChips";
import {
  type WeightUnit,
  displayWeight,
  roundDisplayWeight,
  weightUnitLabel,
  toKg,
} from "@/lib/stats/units";

type Props = {
  initial: Equipment;
  units: WeightUnit;
};

const PRESET_ORDER: EquipmentPreset[] = [
  "commercial_gym",
  "functional_gym",
  "home_gym",
  "travel_hotel",
  "bodyweight_only",
  "custom",
];

function clonePreset(preset: EquipmentPreset): Equipment {
  return structuredClone(PRESET_BY_KEY[preset]);
}

export function EquipmentEditor({ initial, units }: Props) {
  const suffix = weightUnitLabel(units);

  // Auto-save closure: serialise the entire Equipment blob and call
  // the existing server action (which validates via `parseEquipment`
  // and writes to `profiles.equipment`).
  const save = useCallback(async (next: Equipment) => {
    const fd = new FormData();
    fd.set("equipmentJson", JSON.stringify(next));
    await updateEquipmentV2(fd);
  }, []);

  const {
    value: equipment,
    setValue: setEquipmentAndSave,
    reset: resetEquipment,
    status,
    retry,
    lastError,
  } = useAutoSave<Equipment>({
    initial,
    save,
    debounceMs: 500,
  });

  // Track the last-rendered preset purely for the `data-preset`
  // attribute on the form (used by e2e specs + diagnostics).
  const [renderedPreset] = useState<EquipmentPreset>(initial.preset);

  /**
   * Sticky snapshot of the user's custom configuration. Captured the
   * moment they switch AWAY from the custom preset so that picking
   * the Custom chip again later restores their previous selections
   * instead of giving them an empty form. Seeded with the incoming
   * `initial` value if it's already custom.
   */
  const customSnapshotRef = useRef<Equipment | null>(
    initial.preset === "custom" ? structuredClone(initial) : null,
  );

  /**
   * Apply a mutation and mark the preset "custom" if it isn't
   * already (the user took ownership of the data). The literal
   * "custom" preset doesn't flip.
   */
  const mutate = (fn: (draft: Equipment) => Equipment) => {
    const next = fn(structuredClone(equipment));
    if (next.preset !== "custom") next.preset = "custom";
    customSnapshotRef.current = structuredClone(next);
    setEquipmentAndSave(next);
  };

  const applyPreset = (key: EquipmentPreset) => {
    // If the user is leaving the custom preset, snapshot the current
    // state so we can restore it if they pick Custom again later.
    if (equipment.preset === "custom" && key !== "custom") {
      customSnapshotRef.current = structuredClone(equipment);
    }
    // Picking Custom: restore from snapshot if we have one, otherwise
    // start from the empty Custom shape.
    if (key === "custom" && customSnapshotRef.current) {
      setEquipmentAndSave(structuredClone(customSnapshotRef.current));
      return;
    }
    // Otherwise: switch baselines — commit immediately.
    setEquipmentAndSave(clonePreset(key));
  };

  // Allow the form to render the literal "custom" badge once the user
  // mutates a preset.
  void resetEquipment;
  void renderedPreset;

  return (
    <div
      data-testid="equipment-editor-form"
      data-preset={equipment.preset}
      style={{ display: "grid", gap: 20 }}
    >
      <PresetRow active={equipment.preset} onPick={applyPreset} />

      <BarsSection
        bars={equipment.bars}
        suffix={suffix}
        units={units}
        onChange={(bars) => mutate((d) => ({ ...d, bars }))}
      />

      <PlatesSection
        plates={equipment.plates}
        suffix={suffix}
        units={units}
        onChange={(plates) => mutate((d) => ({ ...d, plates }))}
      />

      <DumbbellsSection
        dumbbells={equipment.dumbbells}
        suffix={suffix}
        units={units}
        onChange={(dumbbells) => mutate((d) => ({ ...d, dumbbells }))}
      />

      <KettlebellsSection
        kettlebells={equipment.kettlebells}
        suffix={suffix}
        units={units}
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
        units={units}
        onChange={(accessories) => mutate((d) => ({ ...d, accessories }))}
      />

      {lastError && (
        <div
          role="alert"
          data-testid="equipment-editor-error"
          style={{ fontSize: 12, color: "var(--cp-danger)" }}
        >
          {lastError}
        </div>
      )}
      {/* "Saved" wrapper preserved for back-compat with e2e specs that
          assert on `equipment-editor-saved`. Only renders while the
          auto-save chip is in the saved state. */}
      {status === "saved" && (
        <div
          role="status"
          data-testid="equipment-editor-saved"
          style={{ fontSize: 12, color: "var(--cp-success)" }}
        >
          Saved.
        </div>
      )}
      <AutoSaveStatus
        status={status}
        onRetry={retry}
        testIdSuffix="equipment-editor"
      />
    </div>
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
      <div
        data-testid="equipment-preset-hint"
        style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 6 }}
      >
        {PRESET_HINT[active]}
      </div>
    </fieldset>
  );
}

// ─── Bars ─────────────────────────────────────────────────────────

function BarsSection({
  bars,
  suffix,
  units,
  onChange,
}: {
  bars: Equipment["bars"];
  suffix: string;
  units: WeightUnit;
  onChange: (next: Equipment["bars"]) => void;
}) {
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-bars">
      <Legend>Bars</Legend>
      <BarKgRow
        label="Olympic barbell"
        valueKg={bars.barbellKg}
        suffix={suffix}
        units={units}
        testIdRoot="equipment-bar-olympic"
        onChange={(v) => onChange({ ...bars, barbellKg: v ?? 0 })}
        allowDisable={false}
      />
      <BarKgRow
        label="Trap / hex bar"
        valueKg={bars.trapBarKg}
        suffix={suffix}
        units={units}
        testIdRoot="equipment-bar-trap"
        onChange={(v) => onChange({ ...bars, trapBarKg: v })}
        allowDisable
      />
      <BarKgRow
        label="Safety squat bar"
        valueKg={bars.safetyBarKg}
        suffix={suffix}
        units={units}
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
  units,
  testIdRoot,
  onChange,
  allowDisable,
}: {
  label: string;
  valueKg: number | null;
  suffix: string;
  units: WeightUnit;
  testIdRoot: string;
  onChange: (next: number | null) => void;
  allowDisable: boolean;
}) {
  const present = valueKg != null;
  // Display-unit converted value for the input
  const displayVal = present
    ? roundDisplayWeight(displayWeight(valueKg, units), units)
    : 0;
  // Input constraints in display units
  const maxDisplay = units === "imperial" ? 132 : 60;
  const stepDisplay = units === "imperial" ? 1 : 0.5;
  // Default when "Add" is clicked: 45 lb for imperial, 25 kg for metric
  const defaultKg = units === "imperial" ? toKg(45, "imperial") : 25;
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
              step={stepDisplay}
              min="0"
              max={maxDisplay}
              inputMode="decimal"
              value={displayVal}
              data-testid={`${testIdRoot}-kg`}
              onChange={(e) => onChange(toKg(Number(e.target.value), units))}
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
            onClick={() => onChange(defaultKg)}
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

const COMMON_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];
const COMMON_PLATES_LB = [45, 35, 25, 10, 5, 2.5];

function PlatesSection({
  plates,
  suffix,
  units,
  onChange,
}: {
  plates: number[];
  suffix: string;
  units: WeightUnit;
  onChange: (next: number[]) => void;
}) {
  const [customWeight, setCustomWeight] = useState("");
  const commonList = units === "imperial" ? COMMON_PLATES_LB : COMMON_PLATES_KG;

  // Check if a common display value V is active in the kg plates array
  const isCommonActive = (displayVal: number): boolean =>
    plates.some(
      (kg) => roundDisplayWeight(displayWeight(kg, units), units) === displayVal,
    );

  // Find the kg entry matching a common display value
  const findKgForDisplay = (displayVal: number): number | undefined =>
    plates.find(
      (kg) => roundDisplayWeight(displayWeight(kg, units), units) === displayVal,
    );

  const toggleCommon = (displayVal: number) => {
    if (isCommonActive(displayVal)) {
      // Remove the matching kg entry
      const matchKg = findKgForDisplay(displayVal);
      if (matchKg != null) {
        onChange(plates.filter((p) => p !== matchKg));
      }
    } else {
      // Add: convert display value → kg
      const kgVal = toKg(displayVal, units);
      onChange([...plates, kgVal].sort((a, b) => b - a));
    }
  };

  // "Extra" plates: kg entries that don't match any common display value
  const extraPlates = plates.filter(
    (kg) =>
      !commonList.some(
        (cv) => roundDisplayWeight(displayWeight(kg, units), units) === cv,
      ),
  );

  const addCustom = () => {
    const n = Number(customWeight);
    const maxDisplay = units === "imperial" ? 220 : 100;
    if (!Number.isFinite(n) || n <= 0 || n > maxDisplay) return;
    const kgVal = toKg(n, units);
    if (plates.some((p) => Math.abs(p - kgVal) < 0.01)) return;
    onChange([...plates, kgVal].sort((a, b) => b - a));
    setCustomWeight("");
  };

  const maxDisplay = units === "imperial" ? 220 : 100;

  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-plates">
      <Legend>Plates</Legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {commonList.map((w) => (
          <ToggleChip
            key={w}
            label={`${w} ${suffix}`}
            active={isCommonActive(w)}
            onToggle={() => toggleCommon(w)}
            testId={`equipment-plate-${String(w).replace(".", "_")}`}
          />
        ))}
        {extraPlates.map((p) => (
          <ToggleChip
            key={`extra-${p}`}
            label={`${roundDisplayWeight(displayWeight(p, units), units)} ${suffix}`}
            active
            onToggle={() => onChange(plates.filter((x) => x !== p))}
            testId={`equipment-plate-extra-${String(p).replace(".", "_")}`}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input
          type="number"
          step="0.25"
          min="0.25"
          max={maxDisplay}
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
  units,
  onChange,
}: {
  dumbbells: Equipment["dumbbells"];
  suffix: string;
  units: WeightUnit;
  onChange: (next: Equipment["dumbbells"]) => void;
}) {
  const available = dumbbells != null;
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-dumbbells">
      <Legend>Dumbbells</Legend>
      <SimpleToggleRow
        label="Available"
        present={available}
        testIdRoot="equipment-dumbbells"
        onTogglePresent={(v) =>
          onChange(v ? dumbbells ?? { minKg: 5, maxKg: 50, stepKg: 2.5 } : null)
        }
      />
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
            valueKg={dumbbells.minKg}
            suffix={suffix}
            units={units}
            testId="equipment-dumbbells-min"
            onChange={(v) => onChange({ ...dumbbells, minKg: v })}
          />
          <RangeInput
            label="to"
            valueKg={dumbbells.maxKg}
            suffix={suffix}
            units={units}
            testId="equipment-dumbbells-max"
            onChange={(v) => onChange({ ...dumbbells, maxKg: v })}
          />
          <RangeInput
            label="in"
            valueKg={dumbbells.stepKg}
            suffix={`${suffix} steps`}
            units={units}
            testId="equipment-dumbbells-step"
            onChange={(v) => onChange({ ...dumbbells, stepKg: v })}
          />
        </div>
      )}
    </fieldset>
  );
}

// ─── Kettlebells ──────────────────────────────────────────────────

const COMMON_KBS_KG = [8, 12, 16, 20, 24, 28, 32, 40];
const COMMON_KBS_LB = [18, 26, 35, 44, 53, 62, 70];

function KettlebellsSection({
  kettlebells,
  suffix,
  units,
  onChange,
}: {
  kettlebells: number[];
  suffix: string;
  units: WeightUnit;
  onChange: (next: number[]) => void;
}) {
  const [customWeight, setCustomWeight] = useState("");
  const commonList = units === "imperial" ? COMMON_KBS_LB : COMMON_KBS_KG;

  const isCommonActive = (displayVal: number): boolean =>
    kettlebells.some(
      (kg) => roundDisplayWeight(displayWeight(kg, units), units) === displayVal,
    );

  const findKgForDisplay = (displayVal: number): number | undefined =>
    kettlebells.find(
      (kg) => roundDisplayWeight(displayWeight(kg, units), units) === displayVal,
    );

  const toggleCommon = (displayVal: number) => {
    if (isCommonActive(displayVal)) {
      const matchKg = findKgForDisplay(displayVal);
      if (matchKg != null) {
        onChange(kettlebells.filter((k) => k !== matchKg));
      }
    } else {
      const kgVal = toKg(displayVal, units);
      onChange([...kettlebells, kgVal].sort((a, b) => a - b));
    }
  };

  const extraKbs = kettlebells.filter(
    (kg) =>
      !commonList.some(
        (cv) => roundDisplayWeight(displayWeight(kg, units), units) === cv,
      ),
  );

  const addCustom = () => {
    const n = Number(customWeight);
    if (!Number.isFinite(n) || n <= 0 || n > (units === "imperial" ? 220 : 100)) return;
    const kgVal = toKg(n, units);
    if (kettlebells.some((k) => Math.abs(k - kgVal) < 0.01)) return;
    onChange([...kettlebells, kgVal].sort((a, b) => a - b));
    setCustomWeight("");
  };

  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-kettlebells">
      <Legend>Kettlebells</Legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {commonList.map((w) => (
          <ToggleChip
            key={w}
            label={`${w} ${suffix}`}
            active={isCommonActive(w)}
            onToggle={() => toggleCommon(w)}
            testId={`equipment-kb-${w}`}
          />
        ))}
        {extraKbs.map((k) => (
          <ToggleChip
            key={`extra-${k}`}
            label={`${roundDisplayWeight(displayWeight(k, units), units)} ${suffix}`}
            active
            onToggle={() => onChange(kettlebells.filter((x) => x !== k))}
            testId={`equipment-kb-extra-${k}`}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input
          type="number"
          step="0.5"
          min="1"
          max={units === "imperial" ? 220 : 100}
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
  units,
  onChange,
}: {
  accessories: Equipment["accessories"];
  suffix: string;
  units: WeightUnit;
  onChange: (next: Equipment["accessories"]) => void;
}) {
  const toggleAnkle = () => {
    if (accessories.ankleWeights) {
      onChange({ ...accessories, ankleWeights: false });
    } else {
      onChange({ ...accessories, ankleWeights: { kg: 2.5 } });
    }
  };
  return (
    <fieldset style={fieldsetStyle} data-testid="equipment-accessories">
      <Legend>Accessories</Legend>
      <div style={{ display: "grid", gap: 10 }}>
        <ChipAccessoryRow
          label="Weighted vest"
          values={accessories.weightedVest}
          testIdRoot="equipment-accessory-vest"
          units={units}
          onChange={(next) =>
            onChange({ ...accessories, weightedVest: next })
          }
          defaultKg={9}
        />
        <ChipAccessoryRow
          label="Sandbag"
          values={accessories.sandbag}
          testIdRoot="equipment-accessory-sandbag"
          units={units}
          onChange={(next) => onChange({ ...accessories, sandbag: next })}
          defaultKg={25}
        />
        <SimpleToggleRow
          label="Dip belt"
          present={accessories.dipBelt}
          testIdRoot="equipment-accessory-dipBelt"
          onTogglePresent={(v) =>
            onChange({
              ...accessories,
              dipBelt: v,
              dipBeltMaxKg: v ? accessories.dipBeltMaxKg ?? 40 : null,
            })
          }
        />
        <SimpleToggleRow
          label="Resistance bands"
          present={accessories.bands}
          testIdRoot="equipment-accessory-bands"
          onTogglePresent={(v) =>
            onChange({
              ...accessories,
              bands: v,
              bandStrength: v ? accessories.bandStrength ?? "medium" : null,
            })
          }
        />
        <AnkleWeightRow
          present={Boolean(accessories.ankleWeights)}
          kg={accessories.ankleWeights ? accessories.ankleWeights.kg : 2.5}
          units={units}
          suffix={suffix}
          onToggle={toggleAnkle}
          onChangeKg={(v) =>
            onChange({ ...accessories, ankleWeights: { kg: v } })
          }
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

/**
 * On/off chip toggle for an accessory whose advanced parameter is
 * hidden from the UI but still persisted with a sensible default
 * (dip belt → maxKg 40, bands → strength "medium").
 */
function SimpleToggleRow({
  label,
  present,
  testIdRoot,
  onTogglePresent,
}: {
  label: string;
  present: boolean;
  testIdRoot: string;
  onTogglePresent: (v: boolean) => void;
}) {
  return (
    <div
      data-testid={testIdRoot}
      data-present={present ? "true" : "false"}
      style={{ display: "flex", alignItems: "center", gap: 10 }}
    >
      <button
        type="button"
        onClick={() => onTogglePresent(!present)}
        data-testid={`${testIdRoot}-toggle`}
        aria-pressed={present}
        style={checkboxButtonStyle(present)}
      >
        {present ? "✓" : ""}
      </button>
      <span style={{ fontSize: 13, minWidth: 110 }}>{label}</span>
    </div>
  );
}

/**
 * Editable kg-chip row for a multi-weight accessory (vest / sandbag).
 * Empty array = absent; non-empty = present. The first time the user
 * adds a weight via the inline input it appears as a chip.
 */
function ChipAccessoryRow({
  label,
  values,
  testIdRoot,
  units,
  onChange,
  defaultKg,
}: {
  label: string;
  values: number[];
  testIdRoot: string;
  units: WeightUnit;
  onChange: (next: number[]) => void;
  defaultKg: number;
}) {
  const present = values.length > 0;
  return (
    <div
      data-testid={testIdRoot}
      data-present={present ? "true" : "false"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={() => onChange(present ? [] : [defaultKg])}
        data-testid={`${testIdRoot}-toggle`}
        aria-pressed={present}
        style={checkboxButtonStyle(present)}
      >
        {present ? "✓" : ""}
      </button>
      <span style={{ fontSize: 13, minWidth: 110 }}>{label}</span>
      {present && (
        <EditableKgChips
          values={values}
          onChange={onChange}
          units={units}
          min={1}
          max={units === "imperial" ? 440 : 200}
          step={units === "imperial" ? 1 : 0.5}
          testIdPrefix={testIdRoot}
        />
      )}
    </div>
  );
}

function AnkleWeightRow({
  present,
  kg,
  units,
  suffix,
  onToggle,
  onChangeKg,
}: {
  present: boolean;
  kg: number;
  units: WeightUnit;
  suffix: string;
  onToggle: () => void;
  onChangeKg: (v: number) => void;
}) {
  const displayVal = roundDisplayWeight(displayWeight(kg, units), units);
  const maxDisplay = units === "imperial" ? 66 : 30;
  const stepDisplay = units === "imperial" ? 1 : 0.5;
  return (
    <div
      data-testid="equipment-accessory-ankle"
      data-present={present ? "true" : "false"}
      style={{ display: "flex", alignItems: "center", gap: 10 }}
    >
      <button
        type="button"
        onClick={onToggle}
        data-testid="equipment-accessory-ankle-toggle"
        aria-pressed={present}
        style={checkboxButtonStyle(present)}
      >
        {present ? "✓" : ""}
      </button>
      <span style={{ fontSize: 13, minWidth: 110 }}>
        Ankle weights (per pair)
      </span>
      {present && (
        <>
          <input
            type="number"
            step={stepDisplay}
            min="0"
            max={maxDisplay}
            inputMode="decimal"
            value={displayVal}
            data-testid="equipment-accessory-ankle-kg"
            onChange={(e) => onChangeKg(toKg(Number(e.target.value), units))}
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
  valueKg,
  suffix,
  units,
  testId,
  onChange,
}: {
  label: string;
  valueKg: number;
  suffix: string;
  units: WeightUnit;
  testId: string;
  onChange: (v: number) => void;
}) {
  const displayVal = roundDisplayWeight(displayWeight(valueKg, units), units);
  const maxDisplay = units === "imperial" ? 440 : 200;
  const stepDisplay = units === "imperial" ? 1 : 0.5;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{label}</span>
      <input
        type="number"
        step={stepDisplay}
        min="0"
        max={maxDisplay}
        inputMode="decimal"
        value={displayVal}
        data-testid={testId}
        onChange={(e) => onChange(toKg(Number(e.target.value), units))}
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
