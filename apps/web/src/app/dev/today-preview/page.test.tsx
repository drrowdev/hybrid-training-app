import { afterEach, describe, expect, it, vi } from "vitest";
import TodayPreviewPage from "./page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("./preview", () => ({ TodayPreview: () => null }));
afterEach(() => vi.unstubAllEnvs());

describe("Today visual fixture access", () => {
  it("is unavailable in production even with the CI fixture flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_E2E_FIXTURES", "1");
    await expect(TodayPreviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });
  it("renders only in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await TodayPreviewPage({ searchParams: Promise.resolve({ view: "month" }) }))
      .toMatchObject({ props: { month: true } });
  });
});
