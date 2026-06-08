/**
 * Read-only preview of a planned session — title, eyebrow, prescription
 * sections (warm-ups + main work per movement, accessories, hinge
 * compensation, tendon, cardio), and a primary "Start workout" CTA.
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
import {
  collapseIdenticalSetItems,
  groupByMovementThenKind,
  type PrescriptionMovementRow,
} from "@/lib/plan/prescription-grouping";
import { segmentSupersetRows } from "@/lib/plan/superset-grouping";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";
import { CardioCard } from "./CardioCard";
import { makeShouldHideHeading } from "@/lib/session/heading-dedup";
import { BackLink } from "@/components/ui/BackLink";

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

/**
 * Heading dedup is delegated to the shared
 * `lib/session/heading-dedup` helper so the live in-session page can
 * use the same comparison without forking the logic. See that module
 * for the case-insensitive + shorthand-stripping normalisation.
 */

/**
 * `full` (default) is the Preview-page surface: outer max-width
 * container, back link, page header (eyebrow + title + meta), and a
 * bottom "Start workout" CTA.
 *
 * `compact` is the Today-hero surface: just the inner section cards
 * (movements / cardio / accessories / tendon / hinge). The hero card
 * itself owns the eyebrow, title, top-line numbers, and primary CTA,
 * so this variant strips the chrome that would otherwise duplicate
 * them. Outer padding/max-width are also dropped so the section cards
 * sit flush with the hero card's own padding.
 */
export type SessionPreviewVariant = "full" | "compact";

export function SessionPreviewBody({
  session,
  variant = "full",
}: {
  session: SessionPreviewInput;
  variant?: SessionPreviewVariant;
}) {
  const sections = groupByMovementThenKind(session.items);
  // Count every exercise the session prescribes — main lifts AND
  // accessories/tendon/hinge — not just the main-lift sections. Counting
  // only `movements` undersold a strength day ("2 movements" for a session
  // that actually has two main lifts plus six accessories). Cardio is
  // represented by its duration, so it stays out of the exercise count
  // (a pure-cardio session keeps the bare "~N min" meta line).
  const exerciseCount =
    sections.movements.length +
    sections.accessories.length +
    sections.tendon.length +
    sections.hingeCompensations.length;
  const meta = durationLine(session, exerciseCount);
  const hasAnything =
    sections.movements.length > 0 ||
    sections.accessories.length > 0 ||
    sections.hingeCompensations.length > 0 ||
    sections.tendon.length > 0 ||
    sections.cardio.length > 0;

  // Dedup heuristic: when the inner card heading would just repeat
  // `session.title` (already shown above on Preview, or in the hero
  // topline on Today), drop it. The two real cases this fires on:
  //   - cardio-only session: title "VO2 intervals" + movementName
  //     "VO2 Intervals — 4×4" → heading would be redundant.
  //   - single-movement strength session whose title is the movement
  //     name (rare; most strength titles are generic like "Strength
  //     A").
  //
  // Gate the dedup to sessions with at most ONE movement card. On a
  // folded dual-main-lift day the title can equal one lift's name
  // ("Front Squat") while the day also prescribes a second lift; firing
  // the dedup there hid only the first card's heading and left the
  // second showing — an inconsistency. With 2+ movement cards no heading
  // is ever redundant with a single title, so we never hide.
  const shouldHideHeading =
    sections.movements.length > 1
      ? () => false
      : makeShouldHideHeading(session.title);
  const isCompact = variant === "compact";

  // On the Preview page the page header already shows "~35 min" in
  // the meta line, so CardioCard hides its Duration row to avoid
  // repeating it. The compact hero variant dropped the standalone
  // `~N min` topline from the hero card (see Today page edit) so the
  // CardioCard Duration row IS the single source of truth there.
  const hideCardioDurationRow = !isCompact;

  return (
    <div
      data-testid="session-preview-body"
      data-variant={variant}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: isCompact ? 12 : 20,
        ...(isCompact
          ? { padding: 0 }
          : {
              padding: "16px 16px 32px",
              maxWidth: 720,
              margin: "0 auto",
            }),
      }}
    >
      {!isCompact && <BackLink href="/app" label="Today" />}

      {!isCompact && (
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
      )}

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
        {/*
          Strength rendering differs by variant. The full Preview page
          shows every warm-up + working set per movement (the user is
          drilling in to see exactly what they'll do). The compact hero
          condenses each movement to a single overview row
          (name + working-set count + top set) so a strength day with
          two main lifts + a warm-up ramp each doesn't balloon the card
          to 12+ set lines. Cardio keeps its full structured card in
          both variants — it's already compact and reads well there.
          The "Preview" CTA on the hero is the drill-in to full sets.
        */}
        {isCompact
          ? sections.movements.length > 0 && (
              <CondensedStrengthCard sections={sections.movements} />
            )
          : sections.movements.map((sec) => (
              <MovementCard
                key={sec.rowKey}
                section={sec}
                hideHeading={shouldHideHeading(sec.movementName)}
              />
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
          <CardioCard
            key={`cardio-${i}`}
            item={item}
            // On Preview the page meta already shows "~35 min"; drop
            // the Duration row to avoid repeating. The compact hero
            // variant drops that meta line, so we let CardioCard show
            // Duration as the single source of truth.
            hideDurationRow={hideCardioDurationRow}
            hideHeading={shouldHideHeading(item.movementName ?? "Cardio")}
            testId={`session-preview-cardio-${i}`}
            rowTestIdPrefix={`session-preview-cardio-${i}`}
          />
        ))}
      </div>

      {!isCompact && (
        <Link
          href={`/app/sessions/start/${session.id}`}
          className="cp-btn primary big"
          data-testid="session-preview-start-cta"
          style={{ minHeight: 56, justifyContent: "center" }}
        >
          Start workout →
        </Link>
      )}
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
  hideHeading,
}: {
  section: import("@/lib/plan/prescription-grouping").MovementPrescriptionSection;
  hideHeading: boolean;
}) {
  return (
    <section
      data-testid={`session-preview-movement-${section.rowKey}`}
      style={cardStyle}
    >
      <div className="mono" style={eyebrowStyle}>
        STRENGTH
      </div>
      {!hideHeading && (
        <h3 style={movementHeadingStyle}>{section.movementName}</h3>
      )}

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

/**
 * Compact one-line summary of a strength movement's working sets,
 * used by the Today hero. Prefers the marked top set, falling back to
 * the first main set, then any set. Reads "3 sets · top 85% × 5" for
 * %TM-based main work, or "3 sets · 60 kg × 8" for load-based work.
 * The full set-by-set breakdown lives on the Preview page.
 */
function condensedStrengthSummary(
  section: import("@/lib/plan/prescription-grouping").MovementPrescriptionSection,
): string {
  const working = section.sets;
  if (working.length === 0) {
    // No main work parsed (rare). Fall back to the first warm-up so the
    // row never renders an empty right-hand cell.
    const wu = section.warmups[0];
    return wu ? formatPrescriptionItem(wu) : "";
  }
  const top =
    working.find((s) => s.isTopSet) ??
    working.find((s) => s.item.kind === "main") ??
    working[0];
  const setLabel = `${working.length} set${working.length === 1 ? "" : "s"}`;
  const item = top.item;
  if (item.percentTm != null && item.reps != null) {
    return `${setLabel} · top ${item.percentTm}% × ${item.reps}`;
  }
  const formatted = formatPrescriptionItem(item);
  return formatted ? `${setLabel} · ${formatted}` : setLabel;
}

/**
 * Today-hero condensed strength block: a single STRENGTH card with one
 * overview row per movement (name + `condensedStrengthSummary`). Keeps
 * the per-movement `session-preview-movement-<rowKey>` testid on each
 * row so callers/tests can still target individual movements. The full
 * warm-up + working-set breakdown is reached via the hero's "Preview"
 * CTA → the Preview page (full variant).
 */
function CondensedStrengthCard({
  sections,
}: {
  sections: import("@/lib/plan/prescription-grouping").MovementPrescriptionSection[];
}) {
  return (
    <section data-testid="session-preview-section-strength" style={cardStyle}>
      <div className="mono" style={eyebrowStyle}>
        STRENGTH
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sections.map((sec) => (
          <div
            key={sec.rowKey}
            data-testid={`session-preview-movement-${sec.rowKey}`}
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
              style={{ fontSize: 14, fontWeight: 600, color: "var(--cp-text)" }}
            >
              {sec.movementName}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 13,
                color: "var(--cp-text-muted)",
                textAlign: "right",
              }}
            >
              {condensedStrengthSummary(sec) || "—"}
            </span>
          </div>
        ))}
      </div>
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
  rows: PrescriptionMovementRow[];
}) {
  const segments = segmentSupersetRows(rows);
  return (
    <section data-testid={testId} style={cardStyle}>
      <div className="mono" style={eyebrowStyle}>
        {kind}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {segments.map((seg) =>
          seg.kind === "solo" ? (
            <AccessoryRow key={seg.row.rowKey} row={seg.row} />
          ) : (
            <SupersetCluster key={seg.groupId} groupId={seg.groupId}>
              {seg.rows.map((r) => (
                <AccessoryRow key={r.rowKey} row={r} withinSuperset />
              ))}
            </SupersetCluster>
          ),
        )}
      </div>
    </section>
  );
}

function AccessoryRow({
  row,
  withinSuperset = false,
}: {
  row: PrescriptionMovementRow;
  withinSuperset?: boolean;
}) {
  return (
    <div
      data-testid={withinSuperset ? "superset-accessory-row" : undefined}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        padding: "8px 0",
        borderBottom: withinSuperset ? "none" : "1px solid var(--cp-border)",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--cp-text)" }}>
        {row.movementName}
      </span>
      <span
        className="mono"
        style={{ fontSize: 13, color: "var(--cp-text-muted)", textAlign: "right" }}
      >
        {collapseIdenticalSetItems(row.items)
          .map((it) => formatPrescriptionItem(it))
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}

/**
 * Visual bracket around an antagonist superset (ADR 0026). Wraps the paired
 * accessory rows with a left accent rule, a "SUPERSET" tag, and a one-line
 * "alternate, rest once" hint so the lifter understands they do the two
 * movements back-to-back and rest a single time per round. Internal slot codes
 * (A1/A2) are NOT surfaced — only the human idea "do these two together".
 */
function SupersetCluster({
  groupId,
  children,
}: {
  groupId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid="superset-cluster"
      data-superset-group={groupId}
      style={{
        borderLeft: "2px solid var(--cp-accent, var(--cp-text-muted))",
        paddingLeft: 10,
        margin: "2px 0",
        borderBottom: "1px solid var(--cp-border)",
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--cp-accent, var(--cp-text-muted))",
          fontWeight: 600,
          paddingTop: 6,
        }}
      >
        Superset · alternate, rest once
      </div>
      {children}
    </div>
  );
}

/* Local CardioCard removed — both surfaces now import the shared
   `components/session/CardioCard` instead. See the file-header comment
   for the rationale. */
