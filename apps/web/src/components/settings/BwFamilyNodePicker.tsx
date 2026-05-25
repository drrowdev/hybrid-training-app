"use client";

/**
 * Per-family manual node picker for /app/settings/bodyweight-
 * progression.
 *
 * Renders one row per movement family with a node `<select>`,
 * a current-state pill, and a save-on-change pipeline that calls
 * `setBwNodeManual`. The wider list (all 15 families) is rendered by
 * `BwFamiliesManualPicker` below, which owns the "Allow any node"
 * toggle that loosens the prereq gate.
 *
 * Confirm UX for downgrade follows the spec: a single inline button
 * swap — "Save" turns into "Confirm downgrade" + a "Cancel" link —
 * no modal framework involved.
 */
import { useState, useTransition } from "react";
import type { MovementFamily } from "@hta/db";
import { setBwNodeManual } from "@/lib/planner/bw-progress-manual";

export type BwFamilyPickerNode = {
  id: string;
  nodeKey: string;
  displayName: string;
  difficultyAnchor: number;
  prerequisites: string[];
};

export type BwFamilyPickerProps = {
  family: MovementFamily;
  familyLabel: string;
  /** All nodes for this family, ordered by `difficulty_anchor` asc. */
  nodes: BwFamilyPickerNode[];
  currentNodeId: string | null;
  /** Pre-formatted state badge ("TUT 124s · Week 2 at node"). */
  stateBadge?: string | null;
  /** When true, the prereq gate is bypassed in the dropdown options. */
  allowAnyNode: boolean;
};

type Feedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function nodeIsReachable(
  target: BwFamilyPickerNode,
  currentNode: BwFamilyPickerNode | null,
  nodeById: Map<string, BwFamilyPickerNode>,
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

export function BwFamilyNodePicker({
  family,
  familyLabel,
  nodes,
  currentNodeId,
  stateBadge,
  allowAnyNode,
}: BwFamilyPickerProps) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const currentNode = currentNodeId ? nodeById.get(currentNodeId) ?? null : null;

  // Default selection: existing current node, or the family-entry node
  // (lowest anchor) when none exists yet. The select acts as the
  // staging area — change isn't persisted until the user clicks Save.
  const initialSelection =
    currentNodeId ?? nodes[0]?.id ?? "";
  const [selected, setSelected] = useState<string>(initialSelection);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const [pendingDowngradeConfirm, setPendingDowngradeConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

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

  return (
    <div
      data-testid={`bw-family-picker-${family}`}
      style={{
        display: "grid",
        gap: 6,
        padding: "10px 12px",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{familyLabel}</span>
        {stateBadge != null && stateBadge !== "" && (
          <span
            data-testid={`bw-family-picker-state-${family}`}
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 999,
              border: "1px solid var(--cp-border)",
              color: "var(--cp-text-muted)",
            }}
          >
            {stateBadge}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          data-testid={`bw-family-picker-select-${family}`}
          value={selected}
          disabled={isPending}
          onChange={(e) => {
            setSelected(e.target.value);
            setPendingDowngradeConfirm(false);
            setFeedback({ kind: "idle" });
          }}
          style={{
            flex: "1 1 240px",
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid var(--cp-border)",
            background: "var(--cp-surface)",
            color: "var(--cp-text)",
            fontSize: 13,
          }}
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
            data-testid={`bw-family-picker-save-${family}`}
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
              data-testid={`bw-family-picker-confirm-${family}`}
              onClick={() => doSave({ allowDowngrade: true })}
              disabled={isPending}
              className="cp-btn primary"
              style={{ fontSize: 12, padding: "5px 10px" }}
            >
              {feedback.kind === "saving" ? "Saving…" : "Confirm downgrade"}
            </button>
            <button
              type="button"
              data-testid={`bw-family-picker-cancel-${family}`}
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
      {feedback.kind === "saved" && (
        <span
          data-testid={`bw-family-picker-saved-${family}`}
          style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
        >
          Saved. Accumulators reset for this family.
        </span>
      )}
      {feedback.kind === "error" && (
        <span
          data-testid={`bw-family-picker-error-${family}`}
          style={{ fontSize: 11, color: "var(--cp-danger, #c33)" }}
        >
          {feedback.message}
        </span>
      )}
      {pendingDowngradeConfirm && feedback.kind !== "error" && (
        <span
          data-testid={`bw-family-picker-downgrade-warning-${family}`}
          style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
        >
          Lower difficulty than current. Confirm to override.
        </span>
      )}
    </div>
  );
}

export type BwFamiliesManualPickerProps = {
  families: ReadonlyArray<Omit<BwFamilyPickerProps, "allowAnyNode">>;
  initialAllowAnyNode?: boolean;
};

export function BwFamiliesManualPicker({
  families,
  initialAllowAnyNode = false,
}: BwFamiliesManualPickerProps) {
  const [allowAnyNode, setAllowAnyNode] = useState<boolean>(initialAllowAnyNode);
  return (
    <section
      data-testid="bw-families-manual-picker"
      style={{ display: "grid", gap: 10 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ fontSize: 14, margin: 0 }}>Edit nodes directly</h2>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--cp-text-muted)",
          }}
        >
          <input
            type="checkbox"
            data-testid="bw-families-allow-any-node"
            checked={allowAnyNode}
            onChange={(e) => setAllowAnyNode(e.target.checked)}
          />
          Allow any node
        </label>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: "var(--cp-text-muted)",
          lineHeight: 1.5,
        }}
      >
        Off by default — only nodes you&apos;ve earned through prerequisites
        are selectable. Toggle on if you want to seed an advanced starting
        point.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {families.map((f) => (
          <BwFamilyNodePicker
            key={f.family}
            {...f}
            allowAnyNode={allowAnyNode}
          />
        ))}
      </div>
    </section>
  );
}
