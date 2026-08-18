"use client";

/**
 * Four candidate layouts for /app/settings/profile.
 *
 * Common ground across all four:
 *   - No display-name field (it already lives on /app/profile).
 *   - No accordions — every setting is visible without a click.
 *   - Current value is the loudest thing in each block, not the dimmest.
 *   - Grouping is by EFFECT, not by field type:
 *       measurement (units) · calibration (gender + experience) ·
 *       current goal (phase) · new-block defaults (accessory volume)
 *   - Experience keeps its year ranges on screen; only supplementary
 *     copy goes behind "?".
 */

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import {
  Card,
  EXPERIENCE_LABEL,
  EXPERIENCE_OPTIONS,
  ExperienceList,
  Eyebrow,
  FieldStatus,
  GENDER_OPTIONS,
  InfoNote,
  PHASE_LABEL,
  PHASE_OPTIONS,
  PhaseDetail,
  Segmented,
  SoftNote,
  UNITS_LABEL,
  UNITS_OPTIONS,
  VOLUME_LABEL,
  VOLUME_OPTIONS,
  cardStyle,
  useProfileMock,
  type ProfileMock,
} from "./shared";

const UNITS_INFO =
  "Display only. Everything is stored in metric and converted for display — switching never changes your logged numbers.";
const GENDER_INFO =
  "Sets sex-specific strength standards and the loads used for standardised race stations.";
const EXPERIENCE_INFO =
  "Seeds your starting tier. The app then refines it from strength relative to bodyweight, 12-week adherence, schedule regularity and check-in rate. If what it observes disagrees with your choice, it keeps your choice and shows a note.";
const PHASE_INFO =
  "During a cut the app pulls back top-end intensity slightly and protects strength with heavy, low-volume work.";
const VOLUME_INFO =
  "Applies to every program you run, on new blocks only. Main lifts, supplemental and cardio are unchanged; existing blocks keep what they were built with.";

// ─── A · Four open cards ─────────────────────────────────────────────

export function VariantA() {
  const p = useProfileMock();
  return (
    <div className="pl-grid-2">
      <div className="pl-col">
        <Card
          eyebrow="Calibration"
          title="Training experience"
          value={EXPERIENCE_LABEL[p.experience]}
          status={p.status.experience}
          info={<InfoNote>{EXPERIENCE_INFO}</InfoNote>}
        >
          <ExperienceList
            value={p.experience}
            onChange={(v) => p.set("experience", v)}
          />
          <div
            style={{
              display: "grid",
              gap: 8,
              paddingTop: 12,
              borderTop: "1px solid var(--cp-border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                minHeight: 14,
              }}
            >
              <Eyebrow>Strength standards</Eyebrow>
              <FieldStatus status={p.status.gender} />
            </div>
            <Segmented
              name="a-gender"
              legend="Sex for strength standards"
              value={p.gender}
              options={GENDER_OPTIONS}
              onChange={(v) => p.set("gender", v)}
            />
            {p.gender == null && (
              <SoftNote>
                Not set — standards fall back to unisex until you choose.
              </SoftNote>
            )}
          </div>
        </Card>
      </div>

      <div className="pl-col">
        <Card
          eyebrow="Current goal"
          title="Body composition"
          value={PHASE_LABEL[p.phase]}
          status={p.status.phase}
          info={<InfoNote>{PHASE_INFO}</InfoNote>}
        >
          <Segmented
            name="a-phase"
            legend="Body composition phase"
            value={p.phase}
            options={PHASE_OPTIONS}
            onChange={(v) => p.set("phase", v)}
          />
          <PhaseDetail
            startedAt={p.phaseStartedAt}
            targetWeeks={p.phaseTargetWeeks}
            onStartedAt={(v) => p.set("phaseStartedAt", v)}
            onTargetWeeks={(v) => p.set("phaseTargetWeeks", v)}
          />
        </Card>

        <Card
          eyebrow="New-block defaults"
          title="Accessory volume"
          value={VOLUME_LABEL[p.volume]}
          status={p.status.volume}
          info={<InfoNote>{VOLUME_INFO}</InfoNote>}
        >
          <Segmented
            name="a-volume"
            legend="Accessory volume"
            value={p.volume}
            options={VOLUME_OPTIONS}
            onChange={(v) => p.set("volume", v)}
          />
        </Card>

        <Card
          eyebrow="Measurement"
          title="Units"
          value={UNITS_LABEL[p.units]}
          status={p.status.units}
          info={<InfoNote>{UNITS_INFO}</InfoNote>}
        >
          <Segmented
            name="a-units"
            legend="Units"
            value={p.units}
            options={UNITS_OPTIONS}
            onChange={(v) => p.set("units", v)}
          />
        </Card>
      </div>
    </div>
  );
}

// ─── B · Summary strip + focused editor ──────────────────────────────

type PanelKey = "experience" | "phase" | "volume" | "units";

export function VariantB() {
  const p = useProfileMock();
  const [open, setOpen] = useState<PanelKey>("experience");

  const chips: ReadonlyArray<{
    key: PanelKey;
    eyebrow: string;
    label: string;
    value: string;
    status: string;
  }> = [
    {
      key: "experience",
      eyebrow: "Calibration",
      label: "Experience",
      value: EXPERIENCE_LABEL[p.experience],
      status: "experience",
    },
    {
      key: "phase",
      eyebrow: "Current goal",
      label: "Phase",
      value: PHASE_LABEL[p.phase],
      status: "phase",
    },
    {
      key: "volume",
      eyebrow: "New blocks",
      label: "Accessory volume",
      value: VOLUME_LABEL[p.volume],
      status: "volume",
    },
    {
      key: "units",
      eyebrow: "Measurement",
      label: "Units",
      value: UNITS_LABEL[p.units],
      status: "units",
    },
  ];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="pl-grid-4">
        {chips.map((c) => {
          const sel = open === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setOpen(c.key)}
              aria-pressed={sel}
              style={{
                textAlign: "left",
                display: "grid",
                gap: 6,
                padding: 14,
                borderRadius: 12,
                cursor: "pointer",
                minWidth: 0,
                border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
                background: sel ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                transition: "border-color .14s, background .14s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  minHeight: 14,
                }}
              >
                <Eyebrow>{c.eyebrow}</Eyebrow>
                <FieldStatus status={p.status[c.status]} />
              </div>
              <div
                style={{
                  fontFamily: "var(--cp-font-display)",
                  fontSize: 21,
                  fontWeight: 600,
                  lineHeight: 1.1,
                  color: "var(--cp-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.value}
              </div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                {c.label}
              </div>
            </button>
          );
        })}
      </div>

      <section style={{ ...cardStyle, padding: 20 }}>
        {open === "experience" && (
          <>
            <PanelHead title="Training experience" info={EXPERIENCE_INFO} />
            <div className="pl-split">
              <ExperienceList
                value={p.experience}
                onChange={(v) => p.set("experience", v)}
              />
              <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                <Eyebrow>Strength standards</Eyebrow>
                <Segmented
                  name="b-gender"
                  legend="Sex for strength standards"
                  value={p.gender}
                  options={GENDER_OPTIONS}
                  onChange={(v) => p.set("gender", v)}
                />
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "var(--cp-text-muted)",
                  }}
                >
                  {GENDER_INFO}
                </p>
              </div>
            </div>
          </>
        )}
        {open === "phase" && (
          <>
            <PanelHead title="Body composition phase" info={PHASE_INFO} />
            <div className="pl-split">
              <Segmented
                name="b-phase"
                legend="Body composition phase"
                value={p.phase}
                options={PHASE_OPTIONS}
                onChange={(v) => p.set("phase", v)}
              />
              <PhaseDetail
                startedAt={p.phaseStartedAt}
                targetWeeks={p.phaseTargetWeeks}
                onStartedAt={(v) => p.set("phaseStartedAt", v)}
                onTargetWeeks={(v) => p.set("phaseTargetWeeks", v)}
              />
            </div>
          </>
        )}
        {open === "volume" && (
          <>
            <PanelHead title="Accessory volume" info={VOLUME_INFO} />
            <Segmented
              name="b-volume"
              legend="Accessory volume"
              value={p.volume}
              options={VOLUME_OPTIONS}
              onChange={(v) => p.set("volume", v)}
            />
          </>
        )}
        {open === "units" && (
          <>
            <PanelHead title="Units" info={UNITS_INFO} />
            <Segmented
              name="b-units"
              legend="Units"
              value={p.units}
              options={UNITS_OPTIONS}
              onChange={(v) => p.set("units", v)}
            />
          </>
        )}
      </section>
    </div>
  );
}

function PanelHead({ title, info }: { title: string; info: string }) {
  return (
    <header style={{ display: "grid", gap: 6 }}>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--cp-font-display)",
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          color: "var(--cp-text)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--cp-text-muted)",
          maxWidth: 620,
        }}
      >
        {info}
      </p>
    </header>
  );
}

// ─── C · Dense single column ─────────────────────────────────────────

export function VariantC() {
  const p = useProfileMock();
  return (
    <section style={{ ...cardStyle, padding: 0, gap: 0 }}>
      <Row
        eyebrow="Calibration"
        label="Training experience"
        status={p.status.experience}
        first
      >
        <Segmented
          name="c-experience"
          legend="Training experience"
          value={p.experience}
          options={EXPERIENCE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            sub: o.range,
          }))}
          onChange={(v) => p.set("experience", v)}
          size="sm"
          fit
        />
      </Row>
      <Row
        eyebrow="Calibration"
        label="Strength standards"
        status={p.status.gender}
      >
        <Segmented
          name="c-gender"
          legend="Sex for strength standards"
          value={p.gender}
          options={GENDER_OPTIONS}
          onChange={(v) => p.set("gender", v)}
          size="sm"
          fit
        />
      </Row>
      <Row
        eyebrow="Current goal"
        label="Body composition"
        status={p.status.phase}
      >
        <Segmented
          name="c-phase"
          legend="Body composition phase"
          value={p.phase}
          options={PHASE_OPTIONS}
          onChange={(v) => p.set("phase", v)}
          size="sm"
          fit
        />
      </Row>
      <Row
        eyebrow="New blocks"
        label="Accessory volume"
        status={p.status.volume}
      >
        <Segmented
          name="c-volume"
          legend="Accessory volume"
          value={p.volume}
          options={VOLUME_OPTIONS}
          onChange={(v) => p.set("volume", v)}
          size="sm"
          fit
        />
      </Row>
      <Row eyebrow="Measurement" label="Units" status={p.status.units}>
        <Segmented
          name="c-units"
          legend="Units"
          value={p.units}
          options={UNITS_OPTIONS}
          onChange={(v) => p.set("units", v)}
          size="sm"
          fit
        />
      </Row>
    </section>
  );
}

function Row({
  eyebrow,
  label,
  status,
  first,
  children,
}: {
  eyebrow: string;
  label: string;
  status?: "idle" | "saving" | "saved";
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="pl-row"
      style={{
        padding: "14px 18px",
        borderTop: first ? "none" : "1px solid var(--cp-border)",
      }}
    >
      <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--cp-text)" }}>
          {label}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 12,
          minWidth: 0,
        }}
      >
        {children}
        <span style={{ width: 52, textAlign: "right", flexShrink: 0 }}>
          <FieldStatus status={status} />
        </span>
      </div>
    </div>
  );
}

// ─── D · Cardless two-column form ────────────────────────────────────

export function VariantD() {
  const p = useProfileMock();
  return (
    <div className="pl-cols">
      <div style={{ display: "grid", gap: 26, alignContent: "start", minWidth: 0 }}>
        <Field
          label="Training experience"
          value={EXPERIENCE_LABEL[p.experience]}
          status={p.status.experience}
          hint={EXPERIENCE_INFO}
        >
          <ExperienceList
            value={p.experience}
            onChange={(v) => p.set("experience", v)}
            compact
          />
        </Field>
        <Field
          label="Strength standards"
          value={p.gender === "female" ? "Female" : p.gender === "male" ? "Male" : "Not set"}
          status={p.status.gender}
          hint={GENDER_INFO}
        >
          <Segmented
            name="d-gender"
            legend="Sex for strength standards"
            value={p.gender}
            options={GENDER_OPTIONS}
            onChange={(v) => p.set("gender", v)}
          />
        </Field>
      </div>
      <div style={{ display: "grid", gap: 26, alignContent: "start", minWidth: 0 }}>
        <Field
          label="Body composition phase"
          value={PHASE_LABEL[p.phase]}
          status={p.status.phase}
          hint={PHASE_INFO}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <Segmented
              name="d-phase"
              legend="Body composition phase"
              value={p.phase}
              options={PHASE_OPTIONS}
              onChange={(v) => p.set("phase", v)}
            />
            <PhaseDetail
              startedAt={p.phaseStartedAt}
              targetWeeks={p.phaseTargetWeeks}
              onStartedAt={(v) => p.set("phaseStartedAt", v)}
              onTargetWeeks={(v) => p.set("phaseTargetWeeks", v)}
            />
          </div>
        </Field>
        <Field
          label="Accessory volume"
          value={VOLUME_LABEL[p.volume]}
          status={p.status.volume}
          hint={VOLUME_INFO}
        >
          <Segmented
            name="d-volume"
            legend="Accessory volume"
            value={p.volume}
            options={VOLUME_OPTIONS}
            onChange={(v) => p.set("volume", v)}
          />
        </Field>
        <Field
          label="Units"
          value={UNITS_LABEL[p.units]}
          status={p.status.units}
          hint={UNITS_INFO}
        >
          <Segmented
            name="d-units"
            legend="Units"
            value={p.units}
            options={UNITS_OPTIONS}
            onChange={(v) => p.set("units", v)}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  status,
  hint,
  children,
}: {
  label: string;
  value: string;
  status?: "idle" | "saving" | "saved";
  hint: string;
  children: ReactNode;
}) {
  const head: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 8,
    borderBottom: "1px solid var(--cp-border)",
  };
  return (
    <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <div style={head}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--cp-font-display)",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--cp-text-muted)",
          }}
        >
          {label}
        </h2>
        <FieldStatus status={status} />
      </div>
      <div
        style={{
          fontFamily: "var(--cp-font-display)",
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1,
          color: "var(--cp-text)",
        }}
      >
        {value}
      </div>
      {children}
      <p
        style={{
          margin: 0,
          fontSize: 11.5,
          lineHeight: 1.55,
          color: "var(--cp-text-muted)",
        }}
      >
        {hint}
      </p>
    </div>
  );
}

export const VARIANTS: Record<
  string,
  { title: string; blurb: string; render: () => ReactNode }
> = {
  a: {
    title: "A · Four open cards",
    blurb:
      "Two balanced columns on desktop, one on mobile. Grouped by effect: calibration, current goal, new-block defaults, measurement. Everything visible, zero clicks.",
    render: () => <VariantA />,
  },
  b: {
    title: "B · Summary strip + focus",
    blurb:
      "Four value chips on top answer 'what am I set to' instantly; clicking one opens its editor in a single panel below. Least scrolling, one extra click to edit.",
    render: () => <VariantB />,
  },
  c: {
    title: "C · Dense single column",
    blurb:
      "One card, five rows: label left, control right. The whole profile fits on one screen with no scrolling — but there is no room for the explanatory copy, so every 'why does this matter' has to move elsewhere.",
    render: () => <VariantC />,
  },
  d: {
    title: "D · Cardless two-column form",
    blurb:
      "No boxes at all — hairline rules, big values, generous whitespace. Editorial rather than dashboard; hints stay visible since there is room for them.",
    render: () => <VariantD />,
  },
};

export type ProfileMockType = ProfileMock;
