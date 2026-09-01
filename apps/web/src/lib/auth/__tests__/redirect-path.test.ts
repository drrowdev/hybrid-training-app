import { describe, expect, it } from "vitest";
import { safeAppRedirectPath } from "../redirect-path";

describe("safeAppRedirectPath", () => {
  it("keeps app-relative paths, queries, and fragments", () => {
    expect(safeAppRedirectPath("/app")).toBe("/app");
    expect(safeAppRedirectPath("/app/plan?view=season#week-2")).toBe(
      "/app/plan?view=season#week-2",
    );
  });

  it.each([
    "https://evil.example",
    "http://evil.example",
    "//evil.example/path",
    "\\\\evil.example\\path",
    "/\\evil.example",
    "%2F%2Fevil.example",
    "/%2Fevil.example",
    "/%5Cevil.example",
    "/%255Cevil.example",
    "/%25252Fevil.example",
    "/app\u0000.evil.example",
    "%",
  ])("rejects unsafe redirect target %j", (target) => {
    expect(safeAppRedirectPath(target)).toBe("/app");
  });

  it("uses the supplied fallback for missing or unsafe targets", () => {
    expect(safeAppRedirectPath(null, "/")).toBe("/");
    expect(safeAppRedirectPath("//evil.example", "/login")).toBe("/login");
  });
});
