"use client";

/**
 * Onboarding · Bodyweight assessment · Page 2 — Skill chips.
 *
 * Twelve-chip grid covering the milestone bodyweight skills that
 * either override the rep-test mapping (e.g. `one_arm_push_up`) or
 * unlock a family the rep tests don't probe (planche, levers, flag,
 * muscle-up). Tap to toggle; selected chips are highlighted.
 *
 * Two-column grid on narrow viewports, three-column where there's
 * room (auto-fit, minmax 160px). Each chip carries a 1-line
 * description so the user can confirm which skill is meant without
 * leaving the page.
 *
 * Brand-purity: chip labels are pure movement descriptors — no
 * external program / methodology names.
 */
import { type BwSkillChip } from "@/lib/onboarding/bw-mapping";

type ChipDef = {
  id: BwSkillChip;
  label: string;
  hint: string;
};

const CHIPS: readonly ChipDef[] = [
  { id: "l_sit", label: "L-sit", hint: "Legs straight, 10s+ hold off the floor or rings." },
  {
    id: "tuck_planche",
    label: "Tuck planche",
    hint: "Knees to chest, feet off the floor, 5s+ hold.",
  },
  {
    id: "tuck_front_lever",
    label: "Tuck front lever",
    hint: "Hanging, back parallel to floor in a tuck, 5s+.",
  },
  {
    id: "tuck_back_lever",
    label: "Tuck back lever",
    hint: "Hanging face-down, tucked, body parallel to floor, 5s+.",
  },
  {
    id: "pistol_squat",
    label: "Pistol squat",
    hint: "One-leg squat, full depth, no hand support.",
  },
  {
    id: "wall_handstand",
    label: "Wall handstand hold",
    hint: "Chest-to-wall or back-to-wall, 30s+ hold.",
  },
  {
    id: "freestanding_handstand",
    label: "Freestanding handstand",
    hint: "Balanced handstand off the wall, 10s+ hold.",
  },
  {
    id: "muscle_up",
    label: "Strict muscle-up",
    hint: "Pull-up → transition → dip in one motion, no kip.",
  },
  {
    id: "human_flag",
    label: "Human flag (vertical)",
    hint: "Side hold on a vertical pole, body off vertical, 3s+.",
  },
  {
    id: "nordic_curl",
    label: "Nordic curl (eccentric)",
    hint: "Controlled lower from kneeling with ankles pinned.",
  },
  {
    id: "one_arm_push_up",
    label: "One-arm push-up",
    hint: "One arm strict, chest to floor, no twisting at the hip.",
  },
  {
    id: "one_arm_pull_up",
    label: "One-arm pull-up",
    hint: "One hand on the bar, chin over the bar, no kip.",
  },
];

export type SkillChipsPageProps = {
  selected: BwSkillChip[];
  onChange: (next: BwSkillChip[]) => void;
};

export function SkillChipsPage({ selected, onChange }: SkillChipsPageProps) {
  const selectedSet = new Set(selected);
  const toggle = (id: BwSkillChip) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((c) => c !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div data-testid="bw-assessment-skill-chips" style={{ display: "grid", gap: 18 }}>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--cp-text-muted)",
          lineHeight: 1.55,
        }}
      >
        Tap any skill you can perform with strict form right now. These set the
        starting node for each family.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 8,
        }}
      >
        {CHIPS.map((c) => {
          const sel = selectedSet.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              aria-pressed={sel}
              data-testid={`bw-assessment-chip-${c.id}`}
              data-selected={sel ? "true" : "false"}
              style={chipStyle(sel)}
              title={c.hint}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--cp-text-muted)",
                  lineHeight: 1.4,
                }}
              >
                {c.hint}
              </span>
            </button>
          );
        })}
      </div>

      <p style={{ margin: 0, fontSize: 11, color: "var(--cp-text-muted)" }}>
        {selectedSet.size === 0
          ? "Nothing selected. The rep tests on the previous page are enough to start."
          : `${selectedSet.size} skill${selectedSet.size === 1 ? "" : "s"} selected.`}
      </p>
    </div>
  );
}

function chipStyle(selected: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    padding: 10,
    minHeight: 44,
    borderRadius: 10,
    border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
    background: selected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
    color: "var(--cp-text)",
    cursor: "pointer",
    display: "grid",
    gap: 4,
  };
}
