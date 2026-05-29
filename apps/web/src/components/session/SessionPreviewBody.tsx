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
 */
import Link from "next/link";
import type { PrescriptionItem } from "@hta/db";
import { groupByMovementThenKind } from "@/lib/plan/prescription-grouping";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";

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

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 16,
          borderRadius: 12,
          background: "var(--cp-bg-elevated)",
          border: "1px solid var(--cp-border)",
        }}
      >
        {!hasAnything && (
          <div
            data-testid="session-preview-empty"
            style={{ fontSize: 13, color: "var(--cp-text-muted)" }}
          >
            No prescription details available for this session.
          </div>
        )}

        {sections.movements.map((sec) => (
          <section
            key={sec.rowKey}
            data-testid={`session-preview-movement-${sec.rowKey}`}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--cp-text)",
                marginBottom: 8,
              }}
            >
              {sec.movementName}
            </div>
            {sec.warmups.length > 0 && (
              <>
                <SectionLabel>Warm-up</SectionLabel>
                {sec.warmups.map((it, i) => (
                  <PreviewRow key={`w-${i}`} label={`W${i + 1}`} item={it} />
                ))}
              </>
            )}
            {sec.sets.length > 0 && (
              <>
                <SectionLabel>{sec.sets.length > 1 ? "Main lift" : "Main"}</SectionLabel>
                {sec.sets.map((row, i) => (
                  <PreviewRow
                    key={`m-${i}`}
                    label={String(row.setNumber)}
                    item={row.item}
                  />
                ))}
              </>
            )}
          </section>
        ))}

        {sections.accessories.length > 0 && (
          <PreviewRowSection
            testId="session-preview-section-accessories"
            label="Accessories"
            prefix="A"
            rows={sections.accessories}
          />
        )}
        {sections.tendon.length > 0 && (
          <PreviewRowSection
            testId="session-preview-section-tendon"
            label="Tendon work"
            prefix="T"
            rows={sections.tendon}
          />
        )}
        {sections.hingeCompensations.length > 0 && (
          <PreviewRowSection
            testId="session-preview-section-hinge"
            label="Posterior chain"
            prefix="H"
            rows={sections.hingeCompensations}
          />
        )}
        {sections.cardio.length > 0 && (
          <section data-testid="session-preview-section-cardio">
            <SectionLabel>Cardio</SectionLabel>
            {sections.cardio.map((it, i) => (
              <PreviewRow key={`c-${i}`} label={`C${i + 1}`} item={it} />
            ))}
          </section>
        )}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: "0.08em",
        color: "var(--cp-text-muted)",
        textTransform: "uppercase",
        margin: "8px 0 4px",
      }}
    >
      {children}
    </div>
  );
}

function PreviewRow({ label, item }: { label: string; item: PrescriptionItem }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        gap: 10,
        alignItems: "baseline",
        padding: "6px 0",
        borderBottom: "1px solid var(--cp-border)",
        fontSize: 13,
      }}
    >
      <span
        className="mono"
        style={{ color: "var(--cp-text-muted)", fontSize: 11 }}
      >
        {label}
      </span>
      <span style={{ color: "var(--cp-text)" }}>
        {item.movementName ?? "Movement"}
      </span>
      <span
        className="mono"
        style={{ color: "var(--cp-text-muted)", fontSize: 12 }}
      >
        {formatPrescriptionItem(item)}
      </span>
    </div>
  );
}

function PreviewRowSection({
  label,
  prefix,
  rows,
  testId,
}: {
  label: string;
  prefix: string;
  rows: Array<{ rowKey: string; movementName: string; items: PrescriptionItem[] }>;
  testId: string;
}) {
  return (
    <section data-testid={testId}>
      <SectionLabel>{label}</SectionLabel>
      {rows.map((r, i) => (
        <div
          key={r.rowKey}
          style={{
            display: "grid",
            gridTemplateColumns: "28px 1fr auto",
            gap: 10,
            alignItems: "baseline",
            padding: "6px 0",
            borderBottom: "1px solid var(--cp-border)",
            fontSize: 13,
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--cp-text-muted)", fontSize: 11 }}
          >
            {prefix}
            {i + 1}
          </span>
          <span style={{ color: "var(--cp-text)" }}>{r.movementName}</span>
          <span
            className="mono"
            style={{ color: "var(--cp-text-muted)", fontSize: 12 }}
          >
            {r.items.map((it, j) => (
              <span key={j}>
                {j > 0 ? " · " : ""}
                {formatPrescriptionItem(it)}
              </span>
            ))}
          </span>
        </div>
      ))}
    </section>
  );
}
