/**
 * `getFormatProfile` is the canonical helper every server surface uses
 * to thread the user's `date_format` / `time_format` / `timezone`
 * preferences into `formatDate` / `formatTime`. These tests pin the
 * select shape (so future column adds don't silently drop the format
 * preferences) and the null-row behaviour.
 */
import { describe, expect, it, vi } from "vitest";
import { getFormatProfile } from "../profile";

type Row = {
  timezone: string | null;
  time_format: string | null;
  date_format: string | null;
};

function mockClient(row: Row | null, selectSpy?: (cols: string) => void) {
  return {
    from(table: string) {
      expect(table).toBe("profiles");
      return {
        select(cols: string) {
          selectSpy?.(cols);
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  return { data: row };
                },
              };
            },
          };
        },
      };
    },
  } as never;
}

describe("getFormatProfile", () => {
  it("selects the three format-relevant columns and only those", async () => {
    const selectSpy = vi.fn();
    const supabase = mockClient(
      { timezone: "Europe/Helsinki", time_format: "24h", date_format: "dmy_short" },
      selectSpy,
    );
    const out = await getFormatProfile(supabase, "u1");
    expect(selectSpy).toHaveBeenCalledWith("timezone, time_format, date_format");
    expect(out).toEqual({
      timezone: "Europe/Helsinki",
      time_format: "24h",
      date_format: "dmy_short",
    });
  });

  it("returns null when no profile row exists", async () => {
    const supabase = mockClient(null);
    const out = await getFormatProfile(supabase, "u1");
    expect(out).toBeNull();
  });

  it("normalises missing columns to null (auto-resolve fallback)", async () => {
    const supabase = mockClient({
      timezone: "America/New_York",
      time_format: null,
      date_format: null,
    });
    const out = await getFormatProfile(supabase, "u1");
    expect(out).toEqual({
      timezone: "America/New_York",
      time_format: null,
      date_format: null,
    });
  });
});
