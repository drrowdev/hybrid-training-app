/**
 * ChatFab — renders the FAB button with the locked testid.
 *
 * Project vitest config runs in `node` without jsdom, so we use
 * `renderToStaticMarkup` for static-markup assertions (matches the
 * pattern used in HrZonesSettings.test.tsx).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatFab } from "../ChatFab";

describe("ChatFab", () => {
  it("renders the FAB button with the locked testid + aria label", () => {
    const html = renderToStaticMarkup(<ChatFab onClick={() => {}} />);
    expect(html).toContain('data-testid="ai-chat-fab"');
    expect(html).toContain('aria-label="Open AI chat"');
  });
});
