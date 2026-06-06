import { describe, it, expect } from "vitest";
import { askWhySessionId } from "../ask-why";

describe("askWhySessionId", () => {
  it("prefers the linked session id once the day has been started", () => {
    expect(
      askWhySessionId({ id: "planned-1", completedSessionId: "session-9" }),
    ).toBe("session-9");
  });

  it("falls back to the planned id when no session is linked yet", () => {
    expect(
      askWhySessionId({ id: "planned-1", completedSessionId: null }),
    ).toBe("planned-1");
  });
});
