import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinishSessionBar } from "../FinishSessionBar";
import { SessionLoggingStateProvider } from "../SessionLoggingState";

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
});
