/**
 * /plan/new client switch — toggles between the "Run it again" list and the
 * BlockWizard. Lives outside the server page so the wizard's reducer state
 * survives the back-and-forth, and so the server page stays a thin shell.
 *
 * Recent-block cards now expand inline to a preview panel with two CTAs:
 *
 *   • Start this block   — 1-click clone (same archetype, daysPerWeek,
 *                          day_index_overrides, today's startedOn)
 *   • Customize first    — opens the wizard pre-filled with the source
 *                          block's settings so the user can tweak before
 *                          committing
 *
 * Clicking the card no longer creates a block immediately; this mirrors
 * the iOS-style "tap to expand, then act" pattern the project owner
 * asked for. Source: project-owner UX feedback on /plan/new (this PR).
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  BlockWizard,
  type BlockWizardPrefill,
  type TmReadinessByArchetype,
  type WizardSubmit,
} from "./BlockWizard";

export type RecentBlockCard = {
  id: string;
  archetype: string;
  archetypeName: string;
  startedOn: string;
  daysPerWeek: number | null;
  status: "active" | "completed" | "archived";
  dayIndexOverrides: { days: number[]; twoADay: boolean } | null;
};

export type CreateBlockResult = { ok: true } | { ok: false; error: string };

export function PlanNewSwitch({
  recentBlocks,
  tmReadinessByArchetype,
  allowsTwoADays,
  todayYmd,
  action,
}: {
  recentBlocks: RecentBlockCard[];
  tmReadinessByArchetype: TmReadinessByArchetype;
  allowsTwoADays: boolean;
  todayYmd: string;
  action: (fd: FormData) => Promise<CreateBlockResult>;
}): React.ReactElement {
  const [mode, setMode] = useState<"home" | "wizard">("home");
  const [wizardPrefill, setWizardPrefill] = useState<BlockWizardPrefill | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const completeFromWizard = async (submit: WizardSubmit): Promise<CreateBlockResult> => {
    const fd = new FormData();
    fd.set("archetype", submit.archetypeId);
    fd.set("startedOn", todayYmd);
    fd.set("daysPerWeek", String(submit.daysPerWeek));
    fd.set("dayIndexOverrides", JSON.stringify(submit.dayIndexOverrides));
    fd.set("powerEmphasis", submit.power ? "true" : "false");
    const result = await action(fd);
    if (result.ok) {
      router.push("/app/plan");
      router.refresh();
    }
    return result;
  };

  const startBlockFromCard = (block: RecentBlockCard): void => {
    setError(null);
    const fd = new FormData();
    fd.set("archetype", block.archetype);
    fd.set("startedOn", todayYmd);
    // Default to 4 d/wk when the source block has no recorded
    // daysPerWeek and we couldn't derive one — matches the wizard's
    // own implicit default.
    fd.set("daysPerWeek", String(block.daysPerWeek ?? 4));
    if (block.dayIndexOverrides) {
      fd.set("dayIndexOverrides", JSON.stringify(block.dayIndexOverrides));
    }
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/app/plan");
      router.refresh();
    });
  };

  const customizeFromCard = (block: RecentBlockCard): void => {
    setError(null);
    setWizardPrefill({
      archetype: block.archetype,
      daysPerWeek: block.daysPerWeek ?? 4,
      dayIndexOverrides: block.dayIndexOverrides,
    });
    setMode("wizard");
  };

  if (mode === "wizard") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <button
          type="button"
          onClick={() => {
            setMode("home");
            setWizardPrefill(null);
          }}
          className="pn-switch-back"
          style={{
            justifySelf: "start",
            background: "transparent",
            border: "none",
            color: "var(--cp-text-muted)",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ← back to recent blocks
        </button>
        <BlockWizard
          onComplete={completeFromWizard}
          tmReadinessByArchetype={tmReadinessByArchetype}
          allowsTwoADays={allowsTwoADays}
          prefill={wizardPrefill}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {recentBlocks.length > 0 && (
        <section>
          <h2 style={{ fontSize: 16, margin: "0 0 4px", fontWeight: 600 }}>Run it again</h2>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--cp-text-muted)" }}>
            Re-launch the same shape as one of your recent blocks — same days, same focus.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {recentBlocks.map((b) => {
              const expanded = expandedId === b.id;
              return (
                <div key={b.id} style={{ display: "grid", gap: 0 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : b.id)}
                    disabled={pending}
                    aria-expanded={expanded}
                    aria-controls={`pn-recent-panel-${b.id}`}
                    className="pn-recent-card"
                    data-testid="pn-recent-card"
                    data-archetype={b.archetype}
                    style={recentCardStyle(pending, expanded)}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <span>
                          {b.archetypeName}{" "}
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--cp-text-muted)",
                              fontWeight: 500,
                            }}
                          >
                            ·{" "}
                            {b.daysPerWeek != null
                              ? `${b.daysPerWeek} d/wk`
                              : "Unknown frequency"}{" "}
                            · started {b.startedOn}
                          </span>
                        </span>
                        <StatusBadge status={b.status} />
                      </div>
                      <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                        {b.status === "active"
                          ? "Active — preview to clone or tweak"
                          : b.status === "completed"
                            ? "Completed — every planned session was logged"
                            : "Ended early — manually archived"}
                      </div>
                    </div>
                    <span
                      aria-hidden="true"
                      style={{
                        fontSize: 14,
                        color: "var(--cp-text-muted)",
                        transition: "transform .15s",
                        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    >
                      ▾
                    </span>
                  </button>
                  {expanded && (
                    <RecentBlockPreview
                      id={`pn-recent-panel-${b.id}`}
                      block={b}
                      pending={pending}
                      onStart={() => startBlockFromCard(b)}
                      onCustomize={() => customizeFromCard(b)}
                      onClose={() => setExpandedId(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {error && <div style={errorBoxStyle}>{error}</div>}

      <section style={{ display: "grid", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setWizardPrefill(null);
            setMode("wizard");
          }}
          className="pn-cta"
          style={bigCtaStyle}
        >
          Build a new block →
        </button>
        <Link
          href="/app/plan/new/custom"
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            textDecoration: "none",
            justifySelf: "start",
            paddingLeft: 4,
          }}
        >
          More options · build a custom block →
        </Link>
      </section>
    </div>
  );
}

/**
 * Inline preview panel — appears below the clicked recent card. The
 * "shape" line summarises archetype + days + the day-of-week layout so
 * the user can confirm what "Run it again" actually means before
 * committing.
 */
function RecentBlockPreview({
  id,
  block,
  pending,
  onStart,
  onCustomize,
  onClose,
}: {
  id: string;
  block: RecentBlockCard;
  pending: boolean;
  onStart: () => void;
  onCustomize: () => void;
  onClose: () => void;
}): React.ReactElement {
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const overrideDays = block.dayIndexOverrides?.days ?? null;
  const twoADay = block.dayIndexOverrides?.twoADay ?? false;
  return (
    <div id={id} data-testid="pn-recent-preview" style={previewPanelStyle}>
      <dl style={previewDlStyle}>
        <PreviewRow label="Focus" value={block.archetypeName} />
        <PreviewRow
          label="Days / week"
          value={block.daysPerWeek != null ? String(block.daysPerWeek) : "Unknown"}
        />
        {overrideDays && overrideDays.length > 0 && (
          <PreviewRow
            label="Schedule"
            value={
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                {overrideDays.map((d) => (
                  <span key={d} style={dayChipStyle}>
                    {dayLabels[d] ?? `D${d}`}
                  </span>
                ))}
                {twoADay && (
                  <span style={{ ...dayChipStyle, background: "var(--cp-accent-soft)" }}>
                    2×/day
                  </span>
                )}
              </span>
            }
          />
        )}
        <PreviewRow label="Originally started" value={block.startedOn} />
      </dl>
      <div style={previewCtaRowStyle}>
        <button
          type="button"
          onClick={onStart}
          disabled={pending}
          data-testid="pn-preview-start"
          className="pn-preview-start"
          style={primaryCtaStyle}
        >
          {pending ? "Starting…" : "Start this block"}
        </button>
        <button
          type="button"
          onClick={onCustomize}
          disabled={pending}
          data-testid="pn-preview-customize"
          className="pn-preview-customize"
          style={secondaryCtaStyle}
        >
          Customize first
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          data-testid="pn-preview-cancel"
          style={ghostCtaStyle}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={previewRowStyle}>
      <dt style={previewLabelStyle}>{label}</dt>
      <dd style={previewValueStyle}>{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: "active" | "completed" | "archived" }) {
  if (status === "completed") {
    return (
      <span
        data-testid="block-status-badge"
        data-status="completed"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          padding: "2px 7px",
          borderRadius: 999,
          background: "rgba(34, 197, 94, 0.12)",
          color: "rgb(22, 163, 74)",
          border: "1px solid rgba(34, 197, 94, 0.35)",
        }}
      >
        ✓ Completed
      </span>
    );
  }
  if (status === "archived") {
    return (
      <span
        data-testid="block-status-badge"
        data-status="archived"
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          padding: "2px 7px",
          borderRadius: 999,
          background: "var(--cp-surface-muted, rgba(0,0,0,0.04))",
          color: "var(--cp-text-muted)",
          border: "1px solid var(--cp-border)",
        }}
      >
        Ended
      </span>
    );
  }
  return (
    <span
      data-testid="block-status-badge"
      data-status="active"
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 999,
        background: "var(--cp-accent-soft)",
        color: "var(--cp-accent)",
        border: "1px solid var(--cp-accent)",
      }}
    >
      Active
    </span>
  );
}

function recentCardStyle(disabled: boolean, expanded: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    background: "var(--cp-surface)",
    border: `1px solid ${expanded ? "var(--cp-accent)" : "var(--cp-border)"}`,
    borderRadius: expanded ? "12px 12px 0 0" : 12,
    padding: "14px 18px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    color: "var(--cp-text)",
    textAlign: "left",
    opacity: disabled ? 0.5 : 1,
  };
}

const previewPanelStyle: React.CSSProperties = {
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-accent)",
  borderTop: "none",
  borderRadius: "0 0 12px 12px",
  padding: "14px 18px 16px",
  display: "grid",
  gap: 14,
};

const previewDlStyle: React.CSSProperties = {
  margin: 0,
  display: "grid",
  gap: 6,
};

const previewRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 1fr",
  gap: 8,
  alignItems: "baseline",
  fontSize: 13,
};

const previewLabelStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--cp-text-muted)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 600,
};

const previewValueStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--cp-text)",
};

const dayChipStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--cp-surface-soft)",
  color: "var(--cp-text)",
  border: "1px solid var(--cp-border)",
};

const previewCtaRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const primaryCtaStyle: React.CSSProperties = {
  background: "var(--cp-accent)",
  color: "var(--cp-accent-fg)",
  border: "1px solid var(--cp-accent)",
  borderRadius: 12,
  padding: "12px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "center",
  fontFamily: "inherit",
};

const bigCtaStyle: React.CSSProperties = {
  background: "var(--cp-accent)",
  color: "var(--cp-accent-fg)",
  border: "1px solid var(--cp-accent)",
  borderRadius: 12,
  padding: "16px 20px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
  justifySelf: "stretch",
};

const secondaryCtaStyle: React.CSSProperties = {
  background: "var(--cp-surface-soft)",
  color: "var(--cp-text)",
  border: "1px solid var(--cp-border)",
  borderRadius: 12,
  padding: "12px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "center",
  fontFamily: "inherit",
};

const ghostCtaStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--cp-text-muted)",
  border: "1px solid transparent",
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 13,
  cursor: "pointer",
  textAlign: "center",
  fontFamily: "inherit",
};

const errorBoxStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(245, 158, 11, 0.08)",
  border: "1px solid var(--cp-warning, #d97706)",
  color: "var(--cp-text)",
  fontSize: 13,
};
