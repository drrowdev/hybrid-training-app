/**
 * Render contract for the inline workout-rename control. Node static
 * markup (no JSDOM) — pins the initial (non-editing) state: the title
 * text plus the rename affordance. Interactive edit/save is exercised in
 * the Playwright spec.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { EditableSessionTitle } from "../EditableSessionTitle";

describe("EditableSessionTitle", () => {
  it("renders the title and a rename affordance", () => {
    const html = renderToStaticMarkup(
      <EditableSessionTitle sessionId="s1" initialTitle="Front Squat" />,
    );
    expect(html).toContain('data-testid="session-title"');
    expect(html).toContain("Front Squat");
    expect(html).toContain('data-testid="session-title-edit"');
    expect(html).toContain('aria-label="Rename workout"');
  });
});
