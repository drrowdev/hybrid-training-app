/**
 * ChatRoot — verifies the `sxc:ask-coach` pre-seed wiring.
 *
 * The project vitest config runs in `node` (no jsdom), so the event →
 * open-panel flow is unit-tested through the exported `parseAskCoachEvent`
 * helper that drives it, plus a static-markup render proving the panel is
 * closed (FAB only) on first paint.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatRoot, parseAskCoachEvent, ASK_COACH_EVENT } from "../ChatRoot";

describe("ChatRoot — sxc:ask-coach pre-seed", () => {
  it("renders the FAB and keeps the panel closed initially", () => {
    const html = renderToStaticMarkup(<ChatRoot />);
    expect(html).toContain('data-testid="ai-chat-fab"');
    expect(html).not.toContain('data-testid="ai-chat-panel"');
  });

  it("uses the locked event name", () => {
    expect(ASK_COACH_EVENT).toBe("sxc:ask-coach");
  });

  it("parses a valid event detail into a seed that opens the panel", () => {
    const seed = parseAskCoachEvent({
      sessionId: "sess-1",
      prompt: "Why is this workout programmed the way it is?",
    });
    expect(seed).toEqual({
      sessionId: "sess-1",
      prompt: "Why is this workout programmed the way it is?",
    });
  });

  it("allows a prompt with no session id (general ask)", () => {
    const seed = parseAskCoachEvent({ prompt: "Explain my week" });
    expect(seed).toEqual({ sessionId: undefined, prompt: "Explain my week" });
  });

  it("rejects malformed details so the panel won't open with an empty message", () => {
    expect(parseAskCoachEvent(null)).toBeNull();
    expect(parseAskCoachEvent(undefined)).toBeNull();
    expect(parseAskCoachEvent({})).toBeNull();
    expect(parseAskCoachEvent({ prompt: "" })).toBeNull();
    expect(parseAskCoachEvent({ prompt: "   " })).toBeNull();
    expect(parseAskCoachEvent({ sessionId: "x", prompt: 42 })).toBeNull();
  });
});
