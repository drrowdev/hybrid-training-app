/**
 * Render coverage for the redesigned BW progression family row +
 * categories container. Static-markup pattern matches the rest of
 * the codebase — no new test deps.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BwProgressionFamilyRow,
  type BwProgressionFamilyRowProps,
  type BwRowNode,
} from "../BwProgressionFamilyRow";
import {
  BwProgressionCategories,
  type BwCategoryGroup,
} from "../BwProgressionCategories";

const NODES: BwRowNode[] = [
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
    id: "n-adv",
    nodeKey: "archer",
    displayName: "Archer push-up",
    difficultyAnchor: 60,
    prerequisites: ["n-mid"],
  },
];

function rowProps(
  overrides: Partial<BwProgressionFamilyRowProps> = {},
): BwProgressionFamilyRowProps {
  return {
    family: "push_h",
    familyLabel: "Horizontal push",
    nodes: NODES,
    currentNodeId: "n-mid",
    currentDisplayName: "Push-up",
    nextDisplayName: "Archer push-up",
    weeksAtNode: 1,
    tutAccumulated: 124,
    tutRequired: 252,
    allowAnyNode: false,
    loadedSuggestion: null,
    currentLoadKg: 0,
    ...overrides,
  };
}

describe("BwProgressionFamilyRow", () => {
  it("renders the family label, current name, next preview, and inline picker", () => {
    const html = renderToStaticMarkup(<BwProgressionFamilyRow {...rowProps()} />);
    expect(html).toContain('data-testid="bw-family-row-push_h"');
    expect(html).toContain("Horizontal push");
    expect(html).toContain("Push-up");
    expect(html).toContain("Archer push-up");
    expect(html).toContain('data-testid="bw-family-row-select-push_h"');
    // Save button removed — picker auto-saves on selection change.
    expect(html).not.toContain('data-testid="bw-family-row-save-push_h"');
  });

  it("renders the TUT bar + weeks badge when there is progress", () => {
    const html = renderToStaticMarkup(<BwProgressionFamilyRow {...rowProps()} />);
    expect(html).toContain('data-testid="bw-row-weeks-push_h"');
    expect(html).toContain("weeks 1/2");
    expect(html).toContain("TUT 124/252 sec");
    expect(html).toContain('data-testid="bw-row-tut-bar-push_h"');
  });

  it("hides TUT/weeks meta when there is no current node", () => {
    const html = renderToStaticMarkup(
      <BwProgressionFamilyRow
        {...rowProps({
          currentNodeId: null,
          currentDisplayName: null,
          nextDisplayName: null,
          weeksAtNode: 0,
          tutAccumulated: 0,
          tutRequired: 0,
        })}
      />,
    );
    expect(html).not.toContain('data-testid="bw-row-weeks-push_h"');
    expect(html).toContain("Not seeded yet");
  });

  it("renders an inline loaded-BW suggestion + Apply when present", () => {
    const html = renderToStaticMarkup(
      <BwProgressionFamilyRow
        {...rowProps({
          loadedSuggestion: {
            kind: "increase_load",
            deltaKg: 2.5,
            reason: "clean over-completion",
          },
          currentLoadKg: 0,
        })}
      />,
    );
    expect(html).toContain('data-testid="bw-row-loaded-push_h"');
    expect(html).toContain("Loaded (+0 kg)");
    expect(html).toContain("Try +2.5 kg");
    expect(html).toContain('data-testid="bw-row-loaded-apply-push_h"');
  });

  it("renders out-of-reach nodes as `(locked)` when allowAnyNode is off", () => {
    const html = renderToStaticMarkup(
      <BwProgressionFamilyRow
        {...rowProps({ currentNodeId: "n-entry", currentDisplayName: "Wall push-up" })}
      />,
    );
    expect(html).toMatch(
      /<option value="n-adv" disabled="">Archer push-up · anchor 60 \(locked\)<\/option>/,
    );
  });

  it("matches the compact-row snapshot", () => {
    const html = renderToStaticMarkup(<BwProgressionFamilyRow {...rowProps()} />);
    expect(html).toMatchSnapshot();
  });
});

function makeCategory(
  key: string,
  label: string,
  rows: BwCategoryGroup["rows"],
  hasProgress: boolean,
): BwCategoryGroup {
  return { key, label, rows, hasProgress };
}

describe("BwProgressionCategories", () => {
  it("renders one <details> per category and the global allow-any-node toggle", () => {
    const cats: BwCategoryGroup[] = [
      makeCategory("push", "Push", [rowProps()], true),
      makeCategory("pull", "Pull", [
        rowProps({ family: "pull_h", familyLabel: "Horizontal pull" }),
      ], false),
    ];
    const html = renderToStaticMarkup(
      <BwProgressionCategories categories={cats} />,
    );
    expect(html).toContain('data-testid="bw-progression-categories"');
    expect(html).toContain('data-testid="bw-category-push"');
    expect(html).toContain('data-testid="bw-category-pull"');
    expect(html).toContain('data-testid="bw-allow-any-node-global"');
  });

  it("opens categories with progress by default and collapses the rest", () => {
    const cats: BwCategoryGroup[] = [
      makeCategory("push", "Push", [rowProps()], true),
      makeCategory("pull", "Pull", [
        rowProps({ family: "pull_h", familyLabel: "Horizontal pull" }),
      ], false),
    ];
    const html = renderToStaticMarkup(
      <BwProgressionCategories categories={cats} />,
    );
    // The push category renders with `open`; pull renders without.
    expect(html).toMatch(/data-testid="bw-category-push"[^>]*open/);
    expect(html).toMatch(/data-testid="bw-category-pull"[^>]*data-has-progress="false"/);
    expect(html).not.toMatch(/data-testid="bw-category-pull"[^>]*open=""/);
  });

  it("includes a row per family inside each category", () => {
    const cats: BwCategoryGroup[] = [
      makeCategory(
        "push",
        "Push",
        [
          rowProps({ family: "push_h", familyLabel: "Horizontal push" }),
          rowProps({ family: "push_v", familyLabel: "Vertical push" }),
        ],
        true,
      ),
    ];
    const html = renderToStaticMarkup(
      <BwProgressionCategories categories={cats} />,
    );
    expect(html).toContain('data-testid="bw-family-row-push_h"');
    expect(html).toContain('data-testid="bw-family-row-push_v"');
  });

  it("fresh-user shape — all 6 categories collapsed when no progressed families", () => {
    const cats: BwCategoryGroup[] = [
      makeCategory(
        "push",
        "Push",
        [rowProps({ currentNodeId: "n-entry", currentDisplayName: "Wall push-up" })],
        false,
      ),
      makeCategory(
        "pull",
        "Pull",
        [rowProps({ family: "pull_h", currentNodeId: "n-entry", currentDisplayName: "Wall push-up" })],
        false,
      ),
    ];
    const html = renderToStaticMarkup(
      <BwProgressionCategories categories={cats} />,
    );
    expect(html).not.toMatch(/data-testid="bw-category-push"[^>]* open(?:="")?[ >]/);
    expect(html).not.toMatch(/data-testid="bw-category-pull"[^>]* open(?:="")?[ >]/);
  });
});
