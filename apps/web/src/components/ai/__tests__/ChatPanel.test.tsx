/**
 * ChatPanel — verifies the POST body shape for normal vs. seeded sends.
 *
 * Node vitest env (no jsdom), so we test the pure `buildChatBody` helper
 * that the send path uses: normal composer sends omit `context_session_id`
 * entirely (byte-identical to before), while a seeded send includes it.
 */
import { describe, expect, it } from "vitest";

import { buildChatBody, SESSION_FOLLOWUP_CHIPS } from "../ChatPanel";

describe("ChatPanel — buildChatBody", () => {
  it("omits context_session_id for a normal composer send", () => {
    const body = buildChatBody("thread-1", "How is my squat trending?");
    expect(body).toEqual({
      thread_id: "thread-1",
      message: "How is my squat trending?",
    });
    expect("context_session_id" in body).toBe(false);
  });

  it("includes context_session_id for a seeded send", () => {
    const body = buildChatBody(
      null,
      "Why is this workout programmed the way it is?",
      "sess-42",
    );
    expect(body).toEqual({
      thread_id: null,
      message: "Why is this workout programmed the way it is?",
      context_session_id: "sess-42",
    });
  });

  it("omits context_session_id when the session id is an empty string", () => {
    const body = buildChatBody("t", "hi", "");
    expect("context_session_id" in body).toBe(false);
  });
});

describe("ChatPanel — session follow-up chips", () => {
  it("offers session-specific follow-ups", () => {
    expect(SESSION_FOLLOWUP_CHIPS.length).toBeGreaterThanOrEqual(2);
    expect(SESSION_FOLLOWUP_CHIPS).toContain("Why these accessories?");
  });

  it("a chip send carries the session context (so the model can re-read getSessionDetail)", () => {
    for (const chip of SESSION_FOLLOWUP_CHIPS) {
      const body = buildChatBody("t-1", chip, "sess-9");
      expect(body).toEqual({
        thread_id: "t-1",
        message: chip,
        context_session_id: "sess-9",
      });
    }
  });
});
