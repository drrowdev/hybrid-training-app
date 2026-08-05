import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanProgramActions } from "./PlanProgramActions";
import { EndBlockForm } from "./EndBlockForm";

const endAction = vi.fn(async () => {});

describe("PlanProgramActions", () => {
  it("keeps Edit and History visible while rare actions stay in overflow", () => {
    const html = renderToStaticMarkup(
      <PlanProgramActions
        blockId="block"
        canEdit
        editHref="/app/program?edit=block"
        startNewHref="/app/plan?new=1"
        endAction={endAction}
      />,
    );
    expect(html).toContain("Edit program");
    expect(html).toContain("History");
    expect(html).toContain('aria-label="More program actions"');
    expect(html).not.toContain("Start a new program");
    expect(html).not.toContain("End program");
  });
});
describe("EndBlockForm embedded confirmation", () => {
  it("can open directly from the program action panel", () => {
    const html = renderToStaticMarkup(
      <EndBlockForm
        blockId="block"
        action={endAction}
        initiallyOpen
      />,
    );
    expect(html).toContain('data-testid="end-block-form"');
    expect(html).toContain('data-testid="end-block-confirm"');
    expect(html).not.toContain('data-testid="end-block-button"');
  });
});
