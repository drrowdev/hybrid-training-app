/**
 * Read-only preview of a planned session — title, eyebrow, prescription
 * sections (warm-ups + main work per movement, accessories, hinge
 * compensation, tendon, cardio), and a primary "Start session" CTA.
 *
 * Rendered by `/app/plan/preview/[plannedId]` so the user can see what
 * they're about to do before committing the secondary Today-page CTA.
 * The PlanRedesign drawer renders the same body shape but adds
 * interactive scaffolding (set notes, swap form, mark-done buttons);
 * extracting the drawer body into a shared component was deferred —
 * see the PR description for the rationale. This component re-implements
 * the read-only slice with the same vocabulary so visual drift stays
 * obvious in review.
 *
 * NOTE: internal slot codes (W1 / S1 / C1 / A1 / T1 / H1) are NEVER
 * surfaced to the user. Set numbers ("1", "2", "3") within a single
 * movement's warm-up ramp / main lift list ARE user-facing — those are
 * what a lifter calls "set 1" etc., not engine vocabulary.
 */
import Link from "next/link";
import type { PrescriptionItem } from "@hta/db";
import { groupByMovementThenKind } from "@/lib/plan/prescription-grouping";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";
import { cardioPreviewRows } from "./cardio-preview-rows";

export type SessionPreviewInput = {
  id: string;
  title: string;
  /** Eyebrow text, e.g. "ENDURANCE FOCUS · WEEK 2 · WED 27 MAY". */
  eyebrow: string;
  /** Rough estimated duration in minutes, or null when unknown. */
  estDurationMin: number | null;
  items: PrescriptionItem[];
};

function durationLine(input: SessionPreviewInput, movementCount: number): string {
  const parts: string[] = [];
  if (movementCount > 0) {
    parts.push(`${movementCount} movement${movementCount === 1 ? "" : "s"}`);
  }
  if (input.estDurationMin != null) {
    parts.push(`~${input.estDurationMin} min`);
  }
  return parts.join(" · ");
}

export function SessionPreviewBody({ session }: { session: SessionPreviewInput }) {
  const sections = groupByMovementThenKind(session.items);
  const movementCount = sections.movements.length;
  const meta = durationLine(session, movementCount);
  const hasAnything =
    sections.movements.length > 0 ||
    sections.accessories.length > 0 ||
    sections.hingeCompensations.length > 0 ||
    sections.tendon.length > 0 ||
    sections.cardio.length > 0;

  return (
    <div
      data-testid="session-preview-body"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "16px 16px 32px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <div>
        <Link
          href="/app"
          data-testid="session-preview-back"
          style={{
            display: "inline-block",
            fontSize: 13,
            color: "var(--cp-text-muted)",
            textDecoration: "none",
            padding: "6px 0",
          }}
        >
          ← Back to Today
        </Link>
      </div>

      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          className="mono"
          data-testid="session-preview-eyebrow"
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
          }}
        >
          {session.eyebrow}
        </div>
        <h1
          data-testid="session-preview-title"
          style={{ fontSize: 24, fontWeight: 700, color: "var(--cp-text)", margin: 0 }}
        >
          {session.title}
        </h1>
        {meta && (
          <div
            className="mono"
            data-testid="session-preview-meta"
            style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
          >
            {meta}
          </div>
        )}
      </header>

      {!hasAnything && (
        <div
          data-testid="session-preview-empty"
          style={{
            fontSize: 13,
            color: "var(--cp-text-muted)",
            padding: 16,
            borderRadius: 12,
            background: "var(--cp-surface)",
            border: "1px solid var(--cp-border)",
          }}
        >
          No prescription details available for this session.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sections.movements.map((sec) => (
          <MovementCard key={sec.rowKey} section={sec} />
        ))}

        {sections.accessories.length > 0 && (
          <MovementListCard
            testId="session-preview-section-accessories"
            kind="ACCESSORIES"
            rows={sections.accessories}
          />
        )}
        {sections.tendon.length > 0 && (
          <MovementListCard
            testId="session-preview-section-tendon"
            kind="TENDON WORK"
            rows={sections.tendon}
          />
        )}
        {sections.hingeCompensations.length > 0 && (
          <MovementListCard
            testId="session-preview-section-hinge"
            kind="POSTERIOR CHAIN"
            rows={sections.hingeCompensations}
          />
        )}
        {sections.cardio.map((item, i) => (
          <CardioCard key={`cardio-${i}`} item={item} index={i} />
        ))}
      </div>

      <Link
        href={`/app/sessions/start/${session.id}`}
        className="cp-btn primary big"
        data-testid="session-preview-start-cta"
        style={{ minHeight: 56, justifyContent: "center" }}
      >
        Start session →
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Cards                                                                */
/* -------------------------------------------------------------------- */

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
};

const movementHeadingStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: "var(--cp-text)",
  margin: 0,
};

function MovementCard({
  section,
}: {
  section: import("@/lib/plan/prescription-grouping").MovementPrescriptionSection;
}) {
  return (
    <section
      data-testid={`session-preview-movement-${section.rowKey}`}
      style={cardStyle}
    >
      <div className="mono" style={eyebrowStyle}>
        STRENGTH
      </div>
      <h3 style={movementHeadingStyle}>{section.movementName}</h3>

      {section.warmups.length > 0 && (
        <SetGroup label="Warm-up">
          {section.warmups.map((it, i) => (
            <SetLine
              key={`w-${i}`}
              setNumber={i + 1}
              value={formatPrescriptionItem(it)}
            />
          ))}
        </SetGroup>
      )}

      {section.sets.length > 0 && (
        <SetGroup label={section.sets.length > 1 ? "Main lift" : "Main"}>
          {section.sets.map((row, i) => (
            <SetLine
              key={`m-${i}`}
              setNumber={row.setNumber}
              value={formatPrescriptionItem(row.item)}
            />
          ))}
        </SetGroup>
      )}
    </section>
  );
}

function SetGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SetLine({ setNumber, value }: { setNumber: number; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 12,
        alignItems: "baseline",
        padding: "6px 0",
        borderBottom: "1px solid var(--cp-border)",
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 13, color: "var(--cp-text-muted)" }}
      >
        Set {setNumber}
      </span>
      <span
        className="mono"
        style={{ fontSize: 14, color: "var(--cp-text)", textAlign: "right" }}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function MovementListCard({
  testId,
  kind,
  rows,
}: {
  testId: string;
  kind: string;
  rows: Array<{ rowKey: string; movementName: string; items: PrescriptionItem[] }>;
}) {
  return (
    <section data-testid={testId} style={cardStyle}>
      <div className="mono" style={eyebrowStyle}>
        {kind}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.rowKey}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              padding: "8px 0",
              borderBottom: "1px solid var(--cp-border)",
            }}
          >
            <span
              style={{ fontSize: 14, fontWeight: 500, color: "var(--cp-text)" }}
            >
              {r.movementName}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 13,
                color: "var(--cp-text-muted)",
                textAlign: "right",
              }}
            >
              {r.items
                .map((it) => formatPrescriptionItem(it))
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CardioCard({ item, index }: { item: PrescriptionItem; index: number }) {
  const rows = cardioPreviewRows(item);
  const name = item.movementName ?? "Cardio";
  return (
    <section
      data-testid={`session-preview-cardio-${index}`}
      style={cardStyle}
    >
      <div className="mono" style={eyebrowStyle}>
        CARDIO
      </div>
      <h3 style={movementHeadingStyle}>{name}</h3>
      {item.intensityLabel && (
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
          {item.intensityLabel}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((row, i) => (
            <div
              key={i}
              data-testid={`session-preview-cardio-${index}-row-${row.label.toLowerCase().replace(/\s+/g, "-")}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(96px, max-content) 1fr",
                gap: 12,
                alignItems: "baseline",
                padding: "4px 0",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: "var(--cp-text-muted)",
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: "var(--cp-text)",
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
