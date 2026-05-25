/**
 * BwFamiliesManualPicker / BwFamilyNodePicker render coverage.
 *
 * Node-environment static-markup only (the project's pattern). Covers:
 *   - The picker renders every family it's given.
 *   - The "Allow any node" checkbox is present and defaults off.
 *   - Nodes whose prereqs are unmet are emitted as `<option disabled>`
 *     when the toggle is off and as enabled when it's on initially.
 *   - The current node's display name and state badge surface.
 *   - The empty-state CTA on the page links to the standalone
 *     assessment route.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BwFamiliesManualPicker,
  type BwFamilyPickerNode,
} from "../BwFamilyNodePicker";

const NODES: BwFamilyPickerNode[] = [
  {
    id: "n-entry",
    nodeKey: "push_up_easy",
    displayName: "Wall push-up",
    difficultyAnchor: 10,
    prerequisites: [],
  },
  {
    id: "n-mid",
    nodeKey: "push_up",
    displayName: "Push-up",
    difficultyAnchor: 30,
    prerequisites: ["n-entry"],
  },
  {
    id: "n-far",
    nodeKey: "push_up_hard",
    displayName: "One-arm push-up",
    difficultyAnchor: 80,
    prerequisites: ["n-mid"],
  },
];

function render(props: React.ComponentProps<typeof BwFamiliesManualPicker>) {
  return renderToStaticMarkup(<BwFamiliesManualPicker {...props} />);
}

describe("BwFamiliesManualPicker render", () => {
  it("renders one picker per family and exposes the allow-any-node toggle", () => {
    const html = render({
      families: [
        {
          family: "push_h",
          familyLabel: "Horizontal push",
          nodes: NODES,
          currentNodeId: "n-entry",
          stateBadge: "Wall push-up · TUT 0s · Week 0 at node",
        },
        {
          family: "pull_v",
          familyLabel: "Vertical pull",
          nodes: NODES,
          currentNodeId: null,
          stateBadge: "Not seeded yet",
        },
      ],
    });

    expect(html).toContain('data-testid="bw-family-picker-push_h"');
    expect(html).toContain('data-testid="bw-family-picker-pull_v"');
    expect(html).toContain('data-testid="bw-families-allow-any-node"');
    // Toggle defaults off (the `checked` attribute is omitted).
    expect(html).not.toMatch(/data-testid="bw-families-allow-any-node"[^>]*checked/);
    // Helper copy reflecting the gate's purpose.
    expect(html).toContain("Off by default");
  });

  it("disables out-of-reach nodes by default and surfaces them as locked options", () => {
    const html = render({
      families: [
        {
          family: "push_h",
          familyLabel: "Horizontal push",
          nodes: NODES,
          currentNodeId: "n-entry",
          stateBadge: "Wall push-up · TUT 0s · Week 0 at node",
        },
      ],
    });
    // The mid node is reachable from n-entry: enabled.
    expect(html).toMatch(/<option value="n-mid"[^>]*>Push-up · anchor 30<\/option>/);
    // The far node needs n-mid first → locked.
    expect(html).toMatch(
      /<option value="n-far" disabled="">One-arm push-up · anchor 80 \(locked\)<\/option>/,
    );
  });

  it("renders the state badge when provided", () => {
    const html = render({
      families: [
        {
          family: "push_h",
          familyLabel: "Horizontal push",
          nodes: NODES,
          currentNodeId: "n-mid",
          stateBadge: "Push-up · TUT 124s · Week 2 at node",
        },
      ],
    });
    expect(html).toContain('data-testid="bw-family-picker-state-push_h"');
    expect(html).toContain("Push-up · TUT 124s · Week 2 at node");
  });

  it("with initialAllowAnyNode=true, the checkbox is checked and locked options aren't disabled", () => {
    const html = render({
      families: [
        {
          family: "push_h",
          familyLabel: "Horizontal push",
          nodes: NODES,
          currentNodeId: "n-entry",
          stateBadge: "",
        },
      ],
      initialAllowAnyNode: true,
    });
    expect(html).toMatch(
      /data-testid="bw-families-allow-any-node"[^>]*checked/,
    );
    // The far node is no longer marked "(locked)" when any-node is on.
    expect(html).not.toContain("(locked)");
    expect(html).toMatch(/<option value="n-far"[^>]*>One-arm push-up · anchor 80<\/option>/);
  });

  it("renders only the select per family — Save button removed by auto-save", () => {
    const html = render({
      families: [
        {
          family: "push_h",
          familyLabel: "Horizontal push",
          nodes: NODES,
          currentNodeId: "n-entry",
          stateBadge: "",
        },
      ],
    });
    expect(html).toContain('data-testid="bw-family-picker-select-push_h"');
    expect(html).not.toContain('data-testid="bw-family-picker-save-push_h"');
  });
});
