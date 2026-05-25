"use client";

/**
 * Compact, unified family row for the redesigned bodyweight progression
 * page. Replaces the three-section stack (overview row + manual picker
 * card + loaded suggestion card) with a single row per family that
 * carries:
 *   - family label + current node name
 *   - inline `<select>` picker (collapsed picker logic from
 *     `BwFamilyNodePicker.tsx`)
 *   - TUT progress + weeks-at-node line
 *   - "Next:" preview from the catalog DAG
 *   - optional loaded-suggestion line + Apply button when present
 *
 * Mobile-first: the row collapses to a stacked layout under ~520px via
 * a CSS grid that auto-flows the picker control under the labels.
 *
 * Brand-purity (DC-Q6): pure descriptors only. No methodology names.
 */
import { useState, useTransition } from "react";
import type { MovementFamily } from "@hta/db";
import { setBwNodeManual } from "@/lib/planner/bw-progress-manual";
import {
  applyLoadIncrement,
  applyVariantAdvance,
} from "@/lib/settings/bw-loaded-actions";

export type BwRowNode = {
  id: string;
  nodeKey: string;
  displayName: string;
  difficultyAnchor: number;
  prerequisites: string[];
};

export type BwRowLoadedSuggestion =
  | { kind: "hold"; reason: string }
  | { kind: "increase_load"; deltaKg: number; reason: string }
  | {
      kind: "advance_variant";
      toNodeKey: string;
      toNodeId: string;
      toNodeDisplayName: string;
      reason: string;
    };

export type BwProgressionFamilyRowProps = {
  family: MovementFamily;
  familyLabel: string;
  /** Catalog nodes for this family, sorted asc by difficulty_anchor. */
  nodes: BwRowNode[];
  currentNodeId: string | null;
  currentDisplayName: string | null;
  nextDisplayName: string | null;
  weeksAtNode: number;
  tutAccumulated: number;
  tutRequired: number;
  /** Toggle from the global "Allow any node" switch above the list. */
  allowAnyNode: boolean;
  /** Optional loaded-BW suggestion shaped by `suggestLoadOrVariant`. */
  loadedSuggestion?: BwRowLoadedSuggestion | null;
  currentLoadKg?: number;
};

type Feedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function nodeIsReachable(
  target: BwRowNode,
  currentNode: BwRowNode | null,
  nodeById: Map<string, BwRowNode>,
): boolean {
  if (target.prerequisites.length === 0) return true;
  const currentAnchor = currentNode?.difficultyAnchor ?? -Infinity;
  return target.prerequisites.every((pid) => {
    if (currentNode && pid === currentNode.id) return true;
    const p = nodeById.get(pid);
    if (!p) return false;
    return p.difficultyAnchor <= currentAnchor;
  });
}

const rowStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: "12px 14px",
  border: "1px solid var(--cp-border)",
  borderRadius: 10,
  background: "var(--cp-surface)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "none",
  letterSpacing: 0,
};

const selectStyle: React.CSSProperties = {
  flex: "1 1 200px",
  minWidth: 0,
  padding: "5px 8px",
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontSize: 13,
};

const metaLineStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
  color: "var(--cp-text-muted)",
  lineHeight: 1.5,
};

export function BwProgressionFamilyRow(props: BwProgressionFamilyRowProps) {
  const {
    family,
    familyLabel,
    nodes,
    currentNodeId,
    currentDisplayName,
    nextDisplayName,
    weeksAtNode,
    tutAccumulated,
    tutRequired,
    allowAnyNode,
    loadedSuggestion,
    currentLoadKg = 0,
  } = props;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const currentNode = currentNodeId ? nodeById.get(currentNodeId) ?? null : null;

  const initialSelection = currentNodeId ?? nodes[0]?.id ?? "";
  const [selected, setSelected] = useState<string>(initialSelection);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const [pendingDowngradeConfirm, setPendingDowngradeConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [loadPending, startLoad] = useTransition();
  const [loadError, setLoadError] = useState<string | null>(null);

  const targetNode = nodeById.get(selected) ?? null;
  const isDirty = selected !== (currentNodeId ?? "");
  const isDowngrade =
    targetNode != null &&
    currentNode != null &&
    targetNode.difficultyAnchor < currentNode.difficultyAnchor;

  function doSave(args: { allowDowngrade: boolean }) {
    if (!targetNode) return;
    setFeedback({ kind: "saving" });
    startTransition(async () => {
      const result = await setBwNodeManual({
        family,
        nodeId: targetNode.id,
        allowDowngrade: args.allowDowngrade,
        allowSkipPrereqs: allowAnyNode,
      });
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.error });
        return;
      }
      setFeedback({ kind: "saved" });
      setPendingDowngradeConfirm(false);
    });
  }

  function onSaveClick() {
    if (!targetNode || !isDirty) return;
    if (isDowngrade && !pendingDowngradeConfirm) {
      setPendingDowngradeConfirm(true);
      setFeedback({ kind: "idle" });
      return;
    }
    doSave({ allowDowngrade: isDowngrade });
  }

  function onCancelDowngrade() {
    setPendingDowngradeConfirm(false);
    setSelected(currentNodeId ?? nodes[0]?.id ?? "");
    setFeedback({ kind: "idle" });
  }

  function onLoadApply() {
    if (!loadedSuggestion || loadedSuggestion.kind === "hold") return;
    setLoadError(null);
    startLoad(async () => {
      const fd = new FormData();
      fd.set("family", family);
      let res: { ok?: true; error?: string };
      if (loadedSuggestion.kind === "increase_load") {
        fd.set("deltaKg", String(loadedSuggestion.deltaKg));
        res = await applyLoadIncrement(fd);
      } else {
        fd.set("toNodeId", loadedSuggestion.toNodeId);
        res = await applyVariantAdvance(fd);
      }
      if (res.error) setLoadError(res.error);
    });
  }

  const tutPct =
    tutRequired > 0
      ? Math.min(100, Math.round((tutAccumulated / tutRequired) * 100))
      : 0;

  const loadedSuggestionText = (() => {
    if (!loadedSuggestion) return null;
    if (loadedSuggestion.kind === "hold") return loadedSuggestion.reason;
    if (loadedSuggestion.kind === "increase_load")
      return `Try +${loadedSuggestion.deltaKg} kg`;
    return `Advance to ${loadedSuggestion.toNodeDisplayName}`;
  })();

  return (
    <div data-testid={`bw-family-row-${family}`} style={rowStyle}>
      {/* Header line: label + current name */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={labelStyle}>{familyLabel}</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {currentDisplayName ?? "Not seeded yet"}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          Next:{" "}
          <strong style={{ color: "var(--cp-text)" }}>
            {nextDisplayName ?? "—"}
          </strong>
        </span>
      </div>

      {/* Picker line */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          data-testid={`bw-family-row-select-${family}`}
          value={selected}
          disabled={isPending}
          onChange={(e) => {
            setSelected(e.target.value);
            setPendingDowngradeConfirm(false);
            setFeedback({ kind: "idle" });
          }}
          style={selectStyle}
        >
          {nodes.map((n) => {
            const reachable = allowAnyNode || nodeIsReachable(n, currentNode, nodeById);
            return (
              <option key={n.id} value={n.id} disabled={!reachable}>
                {n.displayName} · anchor {n.difficultyAnchor}
                {!reachable ? " (locked)" : ""}
              </option>
            );
          })}
        </select>
        {!pendingDowngradeConfirm && (
          <button
            type="button"
            data-testid={`bw-family-row-save-${family}`}
            onClick={onSaveClick}
            disabled={!isDirty || isPending || !targetNode}
            className="cp-btn primary"
            style={{ fontSize: 12, padding: "5px 10px" }}
          >
            {feedback.kind === "saving" ? "Saving…" : "Save"}
          </button>
        )}
        {pendingDowngradeConfirm && (
          <>
            <button
              type="button"
              data-testid={`bw-family-row-confirm-${family}`}
              onClick={() => doSave({ allowDowngrade: true })}
              disabled={isPending}
              className="cp-btn primary"
              style={{ fontSize: 12, padding: "5px 10px" }}
            >
              {feedback.kind === "saving" ? "Saving…" : "Confirm downgrade"}
            </button>
            <button
              type="button"
              data-testid={`bw-family-row-cancel-${family}`}
              onClick={onCancelDowngrade}
              disabled={isPending}
              className="cp-btn ghost"
              style={{ fontSize: 12, padding: "5px 10px" }}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {/* TUT + weeks meta line — hidden when there's no progress yet
          (tutRequired == 0). */}
      {currentNodeId != null && tutRequired > 0 && (
        <div style={metaLineStyle}>
          <span data-testid={`bw-row-weeks-${family}`}>
            weeks {Math.min(weeksAtNode, 2)}/2
          </span>
          <span style={{ flex: "1 1 90px", minWidth: 90 }}>
            <span style={{ display: "block", marginBottom: 2 }}>
              TUT {tutAccumulated}/{tutRequired} sec
            </span>
            <span
              data-testid={`bw-row-tut-bar-${family}`}
              style={{
                display: "block",
                height: 5,
                borderRadius: 3,
                background: "var(--cp-border)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${tutPct}%`,
                  height: "100%",
                  background: "var(--cp-accent, var(--cp-text))",
                }}
              />
            </span>
          </span>
        </div>
      )}

      {/* Inline loaded-BW suggestion (folded in from the dropped
          standalone section). Only shown when the family is loadable
          and has a current node. */}
      {loadedSuggestion && currentNodeId != null && (
        <div
          data-testid={`bw-row-loaded-${family}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 8,
            background:
              "color-mix(in oklab, var(--cp-accent, var(--cp-text)) 6%, var(--cp-surface))",
            fontSize: 11,
            color: "var(--cp-text)",
          }}
        >
          <span>
            Loaded (+{currentLoadKg} kg) ·{" "}
            <strong>{loadedSuggestionText}</strong>
          </span>
          <button
            type="button"
            data-testid={`bw-row-loaded-apply-${family}`}
            onClick={onLoadApply}
            disabled={loadedSuggestion.kind === "hold" || loadPending}
            className="cp-btn ghost"
            style={{
              fontSize: 11,
              padding: "3px 10px",
              minHeight: 26,
              opacity: loadedSuggestion.kind === "hold" ? 0.5 : 1,
            }}
          >
            {loadPending ? "Applying…" : "Apply"}
          </button>
        </div>
      )}
      {loadError && (
        <span style={{ fontSize: 11, color: "var(--cp-danger, #c33)" }}>
          {loadError}
        </span>
      )}

      {/* Feedback strip — saved / error / downgrade hint */}
      {feedback.kind === "saved" && (
        <span
          data-testid={`bw-family-row-saved-${family}`}
          style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
        >
          Saved. Accumulators reset for this family.
        </span>
      )}
      {feedback.kind === "error" && (
        <span
          data-testid={`bw-family-row-error-${family}`}
          style={{ fontSize: 11, color: "var(--cp-danger, #c33)" }}
        >
          {feedback.message}
        </span>
      )}
      {pendingDowngradeConfirm && feedback.kind !== "error" && (
        <span
          data-testid={`bw-family-row-downgrade-warning-${family}`}
          style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
        >
          Lower difficulty than current. Confirm to override.
        </span>
      )}
    </div>
  );
}
