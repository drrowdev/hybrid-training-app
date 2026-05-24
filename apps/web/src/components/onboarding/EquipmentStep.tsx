"use client";

/**
 * Onboarding · Equipment step.
 *
 * Two-tier UI:
 *  - Tier 1 (default): four big preset cards (Commercial gym / Home gym /
 *    Travel-hotel / Custom). Tapping a card selects that preset.
 *  - Tier 2 (revealed by "Customize"): the existing `<EquipmentEditor>`
 *    rendered inline so the user can fine-tune the preset without
 *    leaving the wizard. The editor owns its own save flow (writes via
 *    `updateEquipmentV2`); the wizard's Continue button only fires the
 *    preset save when the user has NOT entered the customize tier.
 *
 * The component is dumb about wizard-level transitions — it surfaces
 * `selectedPreset` + `equipment` + `customizing` to the parent via
 * callbacks, and the parent owns "save + advance" on Continue.
 *
 * Brand purity: copy is generic — no methodology / external program
 * names. Preset labels live in `equipment-presets.ts` and are pure
 * descriptors of the environment.
 */
import { useMemo, useState } from "react";
import { EquipmentEditor } from "@/components/settings/EquipmentEditor";
import {
  PRESET_BY_KEY,
  PRESET_LABEL,
} from "@/lib/settings/equipment-presets";
import type {
  Equipment,
  EquipmentPreset,
} from "@/lib/settings/equipment-schema";

const PRESET_ORDER: EquipmentPreset[] = [
  "commercial_gym",
  "home_gym",
  "bodyweight_only",
  "travel_hotel",
  "custom",
];

/**
 * Short user-facing description of each preset. Kept inline (not in
 * equipment-presets.ts) because this copy is the onboarding-tier
 * "what does this imply?" hint — the settings page has its own
 * narrower preset row and doesn't need this prose.
 */
const PRESET_HINT: Record<EquipmentPreset, string> = {
  commercial_gym:
    "Full plate range, dumbbells, kettlebells, machines, cables, cardio gear.",
  home_gym:
    "Barbell + plates, optional dumbbells / kettlebells, no machines.",
  bodyweight_only:
    "No equipment beyond your body. Pull-up bar optional.",
  travel_hotel:
    "Limited dumbbells, treadmill, bands. Mostly bodyweight.",
  custom: "Configure exactly what you have.",
};

/** Single emoji glyph per preset — matches the simple icon style of
 *  the existing ProfileStep cards (no SVG assets, just a glyph). */
const PRESET_GLYPH: Record<EquipmentPreset, string> = {
  commercial_gym: "🏋️",
  home_gym: "🏠",
  bodyweight_only: "🤸",
  travel_hotel: "🧳",
  custom: "⚙️",
};

export type EquipmentStepProps = {
  initialEquipment: Equipment;
  /** True when `profiles.equipment` JSONB was already set before this
   *  onboarding run (existing user revisiting the wizard). Drives whether
   *  the matching preset card is firmly selected vs. faintly suggested. */
  hasEquipmentRow: boolean;
  units: "metric" | "imperial";
  selectedPreset: EquipmentPreset | null;
  onSelectPreset: (preset: EquipmentPreset) => void;
  customizing: boolean;
  onToggleCustomize: (next: boolean) => void;
};

export function EquipmentStep({
  initialEquipment,
  hasEquipmentRow,
  units,
  selectedPreset,
  onSelectPreset,
  customizing,
  onToggleCustomize,
}: EquipmentStepProps) {
  /**
   * The editor is an uncontrolled child — every time the user picks a
   * different preset we want it to re-mount with the new preset data.
   * Track a revision counter so React drops the inner editor state on
   * preset change.
   */
  const [editorRev, setEditorRev] = useState(0);
  const handleSelect = (preset: EquipmentPreset) => {
    onSelectPreset(preset);
    setEditorRev((r) => r + 1);
  };

  const editorInitial = useMemo<Equipment>(() => {
    if (selectedPreset) return structuredClone(PRESET_BY_KEY[selectedPreset]);
    return initialEquipment;
  }, [selectedPreset, initialEquipment]);

  return (
    <>
      <div>
        <div style={kickerStyle}>Step 3</div>
        <h2 style={{ fontSize: 22, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
          What equipment do you train with?
        </h2>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--cp-text-muted)",
          lineHeight: 1.55,
        }}
      >
        Pick the option closest to your usual setup. The planner uses this to
        decide which accessory movements you can actually perform — you can
        change it any time in Settings.
      </p>

      <div
        data-testid="onboarding-equipment-presets"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 10,
        }}
      >
        {PRESET_ORDER.map((key) => {
          const selected = selectedPreset === key;
          // When there's no prior equipment row and nothing tapped yet,
          // surface Commercial gym as a faint hint (dashed border) so the
          // user can see the safe default without it being committed.
          const suggested =
            !selectedPreset && !hasEquipmentRow && key === "commercial_gym";
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleSelect(key)}
              aria-pressed={selected}
              data-testid={`onboarding-equipment-preset-${key}`}
              data-selected={selected ? "true" : "false"}
              data-suggested={suggested ? "true" : "false"}
              style={presetCardStyle(selected, suggested)}
            >
              <div style={{ fontSize: 28, lineHeight: 1 }} aria-hidden="true">
                {PRESET_GLYPH[key]}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {PRESET_LABEL[key]}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--cp-text-muted)",
                  lineHeight: 1.45,
                }}
              >
                {PRESET_HINT[key]}
              </div>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          {selectedPreset
            ? `Selected: ${PRESET_LABEL[selectedPreset]}.`
            : "Pick a preset to continue."}
        </span>
        <button
          type="button"
          onClick={() => onToggleCustomize(!customizing)}
          data-testid="onboarding-equipment-customize"
          aria-expanded={customizing}
          className="cp-btn ghost"
          style={{ fontSize: 12 }}
        >
          {customizing ? "Hide details" : "Customize…"}
        </button>
      </div>

      {customizing && (
        <div
          data-testid="onboarding-equipment-editor-panel"
          style={{
            border: "1px solid var(--cp-border)",
            borderRadius: 12,
            padding: 14,
            background: "var(--cp-surface-soft, var(--cp-surface))",
            display: "grid",
            gap: 12,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--cp-text-muted)",
              lineHeight: 1.5,
            }}
          >
            Fine-tune the preset below and hit <strong>Save</strong> here, then
            return to <strong>Continue →</strong>. Skipping save will keep the
            preset values as-is.
          </p>
          <EquipmentEditor
            key={`${selectedPreset ?? "initial"}-${editorRev}`}
            initial={editorInitial}
            units={units}
          />
        </div>
      )}
    </>
  );
}

// ── styles ──────────────────────────────────────────────────────────────

const kickerStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

function presetCardStyle(
  selected: boolean,
  suggested: boolean,
): React.CSSProperties {
  const borderColor = selected
    ? "var(--cp-accent)"
    : suggested
      ? "var(--cp-accent)"
      : "var(--cp-border)";
  return {
    textAlign: "left",
    padding: 16,
    minHeight: 44,
    borderRadius: 12,
    border: `${suggested && !selected ? "1.5px dashed" : "1px solid"} ${borderColor}`,
    background: selected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
    color: "var(--cp-text)",
    cursor: "pointer",
    display: "grid",
    gap: 6,
    opacity: suggested && !selected ? 0.92 : 1,
  };
}
