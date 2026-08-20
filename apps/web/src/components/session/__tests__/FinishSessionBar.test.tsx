import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FinishSessionBar,
  FinishSessionBottomSlot,
  FinishSessionMenuSlot,
  finishPlacement,
} from "../FinishSessionBar";
import { SessionLoggingStateProvider } from "../SessionLoggingState";

describe("Finish placement", () => {
  it("keeps Finish out of the primary slot while required work remains", () => {
    expect(finishPlacement(3)).toBe("menu");
    expect(finishPlacement(0)).toBe("bottom");
  });

  it("shows only one placement at a time", () => {
    const withWorkLeft = (node: React.ReactNode) =>
      renderToStaticMarkup(
        <SessionLoggingStateProvider
          initialHasStrengthSets
          initialUnloggedStrengthCount={2}
          initialUnloggedRequiredIndices={[0, 1]}
        >
          {node}
        </SessionLoggingStateProvider>,
      );
    expect(withWorkLeft(<FinishSessionBottomSlot sessionId="s" disabled={false} />)).toBe("");
    expect(
      withWorkLeft(<FinishSessionMenuSlot sessionId="s" disabled={false} />),
    ).toContain("Finish session");
  });

  it("returns Finish to the primary slot once nothing required is left", () => {
    const done = (node: React.ReactNode) =>
      renderToStaticMarkup(
        <SessionLoggingStateProvider
          initialHasStrengthSets
          initialUnloggedStrengthCount={0}
          initialUnloggedRequiredIndices={[]}
        >
          {node}
        </SessionLoggingStateProvider>,
      );
    expect(done(<FinishSessionMenuSlot sessionId="s" disabled={false} />)).toBe("");
    expect(
      done(<FinishSessionBottomSlot sessionId="s" disabled={false} />),
    ).toContain("Finish session");
  });
});

describe("FinishSessionBar — hybrid clarifier", () => {
  it("renders the generic 'Log at least 1 set to finish' for pure strength (no hybrid prop)", () => {
    const html = renderToStaticMarkup(
      <FinishSessionBar sessionId="s" variant="bottom" disabled />,
    );
    expect(html).toContain("Log at least 1 set to finish");
    expect(html).not.toContain("strength set");
  });

  it("renders the hybrid copy 'Log at least 1 strength set to finish' when hybrid={true}", () => {
    const html = renderToStaticMarkup(
      <FinishSessionBar sessionId="s" variant="bottom" disabled hybrid />,
    );
    expect(html).toContain("Log at least 1 strength set to finish");
  });

  it("ignores the hybrid prop once the bar is armed (Finish session →)", () => {
    const html = renderToStaticMarkup(
      <FinishSessionBar sessionId="s" variant="bottom" disabled={false} hybrid />,
    );
    expect(html).toContain("Finish session");
    expect(html).not.toContain("strength set");
  });

  it("banner variant doesn't show the disabled-state label even when disabled (icon-only)", () => {
    const html = renderToStaticMarkup(
      <FinishSessionBar sessionId="s" variant="banner" disabled hybrid />,
    );
    expect(html).not.toContain("strength set");
  });

  it("arms immediately from client logging state without a page refresh", () => {
    const html = renderToStaticMarkup(
      <SessionLoggingStateProvider
        initialHasStrengthSets
        initialUnloggedStrengthCount={3}
      >
        <FinishSessionBar sessionId="s" variant="bottom" disabled />
      </SessionLoggingStateProvider>,
    );
    expect(html).toContain('data-armed="true"');
    expect(html).toContain("Finish session");
    expect(html).toContain("3 planned sets aren&#x27;t logged");
  });

  it("requires embedded rehab to be logged or explicitly skipped before finishing", () => {
    const html = renderToStaticMarkup(
      <SessionLoggingStateProvider
        initialHasStrengthSets
        initialUnloggedStrengthCount={4}
        initialUnloggedRehabIndices={[0, 1, 2]}
      >
        <FinishSessionBar sessionId="s" variant="bottom" disabled={false} />
      </SessionLoggingStateProvider>,
    );

    expect(html).toContain('data-armed="false"');
    expect(html).toContain("Log or skip rehab to finish");
    expect(html).toContain(
      "3 rehab sets remain. Log or explicitly skip them before finishing.",
    );
  });
});
