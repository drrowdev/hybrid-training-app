import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ProgramPickerPage from "@/app/app/program/page";

const mock = vi.hoisted(() => ({ edit: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font" }) }));
vi.mock("@/lib/platform/edit-context", () => ({ getBlockEditContext: mock.edit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mock.query }),
  getAuthUser: async () => ({ data: { user: { id: "owner" } } }),
}));
vi.mock("@/components/program/ProgramPicker", () => ({
  ProgramPicker: () => { throw new Error("An unavailable edit must not become a new program"); },
}));

describe("DC-R5 explicit program edit target", () => {
  it("does not fall through to creation when the exact target is unavailable", async () => {
    mock.edit.mockResolvedValue(null);
    const page = await ProgramPickerPage({ searchParams: Promise.resolve({ edit: "unavailable-block" }) });
    const html = renderToStaticMarkup(page);
    expect(mock.edit).toHaveBeenCalledWith("unavailable-block");
    expect(mock.query).not.toHaveBeenCalled();
    expect(html).toContain('data-testid="empty-state"');
    expect(html).toContain('href="/app/programs"');
  });
});
