/**
 * ChatMount — verify the access gate is honoured.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const profileMaybeSingle = vi.fn();
const getAuthUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: profileMaybeSingle }),
      }),
    }),
  }),
  getAuthUser: getAuthUserMock,
}));

describe("ChatMount", () => {
  beforeEach(() => {
    profileMaybeSingle.mockReset();
    getAuthUserMock.mockReset();
  });

  it("renders nothing when there is no signed-in user", async () => {
    getAuthUserMock.mockResolvedValueOnce({ data: { user: null } });
    const { ChatMount } = await import("../ChatMount");
    const el = await ChatMount();
    expect(el).toBeNull();
  });

  it("renders nothing when hasAiAccess is false (no opt-in)", async () => {
    getAuthUserMock.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    profileMaybeSingle.mockResolvedValueOnce({
      data: {
        ai_opt_in_at: null,
        byoai_provider: "anthropic",
        byoai_key_vault_id: "v1",
        byoai_unlocked_at: "2026-01-01",
      },
    });
    const { ChatMount } = await import("../ChatMount");
    const el = await ChatMount();
    expect(el).toBeNull();
  });

  it("renders the chat root when hasAiAccess is true", async () => {
    getAuthUserMock.mockResolvedValueOnce({ data: { user: { id: "u1" } } });
    profileMaybeSingle.mockResolvedValueOnce({
      data: {
        ai_opt_in_at: "2026-05-01",
        byoai_provider: "anthropic",
        byoai_key_vault_id: "v1",
        byoai_unlocked_at: "2026-01-01",
      },
    });
    const { ChatMount } = await import("../ChatMount");
    const el = await ChatMount();
    expect(el).not.toBeNull();
  });
});
