"use client";

/**
 * Bodyweight progression — categories container.
 *
 * Groups family rows into 6 collapsible category sections (Push, Pull,
 * Lower body, Core, Skills, Bridges). Owns the single global
 * "Allow any node" toggle that replaces the per-picker checkbox from
 * the prior layout.
 *
 * Categories with at least one progressed family (current node above
 * the entry-anchor floor) default to expanded; entry-only categories
 * default to collapsed. Each section persists its open/closed state
 * locally — no server round-trip; this is pure UI state.
 *
 * Brand-purity (DC-Q6): every label is a plain descriptor.
 */
import { useState } from "react";
import {
  BwProgressionFamilyRow,
  type BwProgressionFamilyRowProps,
} from "./BwProgressionFamilyRow";

export type BwCategoryRow = Omit<BwProgressionFamilyRowProps, "allowAnyNode">;

export type BwCategoryGroup = {
  /** Category key — stable id used for testids. */
  key: string;
  /** Plain-English category label. */
  label: string;
  rows: BwCategoryRow[];
  /** True when at least one family in this category has progressed
   *  beyond its entry-node anchor. Drives the default-expanded gate. */
  hasProgress: boolean;
};

export function BwProgressionCategories({
  categories,
  initialAllowAnyNode = false,
}: {
  categories: ReadonlyArray<BwCategoryGroup>;
  initialAllowAnyNode?: boolean;
}) {
  const [allowAnyNode, setAllowAnyNode] = useState(initialAllowAnyNode);

  return (
    <section
      data-testid="bw-progression-categories"
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
        <h2 style={{ fontSize: 14, margin: 0 }}>Families by category</h2>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--cp-text-muted)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            data-testid="bw-allow-any-node-global"
            checked={allowAnyNode}
            onChange={(e) => setAllowAnyNode(e.target.checked)}
          />
          Allow any node
        </label>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: "var(--cp-text-muted)",
          lineHeight: 1.5,
        }}
      >
        Off by default — only nodes reachable from your current node are
        selectable. Toggle on to seed an advanced starting point on any
        family.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {categories.map((cat) => (
          <CategoryDetails key={cat.key} category={cat} allowAnyNode={allowAnyNode} />
        ))}
      </div>
    </section>
  );
}

function CategoryDetails({
  category,
  allowAnyNode,
}: {
  category: BwCategoryGroup;
  allowAnyNode: boolean;
}) {
  // <details> handles its own open/closed state; we set the
  // defaultOpen flag from `hasProgress` so progressed users open into
  // the categories they care about.
  return (
    <details
      data-testid={`bw-category-${category.key}`}
      data-has-progress={category.hasProgress ? "true" : "false"}
      open={category.hasProgress}
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface-soft, var(--cp-surface))",
        padding: "8px 10px",
      }}
    >
      <summary
        data-testid={`bw-category-summary-${category.key}`}
        style={{
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--cp-text)",
          listStyle: "revert",
          padding: "2px 0",
        }}
      >
        {category.label}{" "}
        <span
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
            fontWeight: 400,
            marginLeft: 4,
          }}
        >
          · {category.rows.length}
        </span>
      </summary>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {category.rows.map((row) => (
          <BwProgressionFamilyRow
            key={row.family}
            {...row}
            allowAnyNode={allowAnyNode}
          />
        ))}
      </div>
    </details>
  );
}
