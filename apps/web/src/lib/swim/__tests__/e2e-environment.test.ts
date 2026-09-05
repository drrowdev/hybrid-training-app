import { describe, expect, it } from "vitest";
import { isDedicatedSwimEnvironment, swimE2EEnabled } from "../../../../e2e/fixtures/swim-environment";

const dedicated = {
  E2E_SWIM_NONPROD: "1",
  E2E_SUPABASE_URL: "https://project-a.supabase.co",
  E2E_SUPABASE_ANON_KEY: ["sb", "publishable", "0123456789abcdefghijklmnopqrstuv"].join("_"),
  E2E_SUPABASE_SERVICE_ROLE_KEY: ["sb", "secret", "0123456789abcdefghijklmnopqrstuv"].join("_"),
  SWIM_TEST_PROJECT_REF: "project-a",
};

describe("ADR0079 dedicated E2E environment guard", () => {
  it("never accepts generic credentials even with the non-production flag", () => {
    expect(isDedicatedSwimEnvironment({
      E2E_SWIM_NONPROD: "1", NEXT_PUBLIC_SUPABASE_URL: dedicated.E2E_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "generic-anon", SUPABASE_SERVICE_ROLE_KEY: "generic-service",
    })).toBe(false);
  });
  it.each(["E2E_SUPABASE_URL", "E2E_SUPABASE_ANON_KEY", "E2E_SUPABASE_SERVICE_ROLE_KEY"])("requires explicit %s", (field) => {
    expect(isDedicatedSwimEnvironment({ ...dedicated, [field]: undefined })).toBe(false);
  });
  it("requires explicit non-production approval", () => {
    expect(isDedicatedSwimEnvironment({ ...dedicated, E2E_SWIM_NONPROD: undefined })).toBe(false);
    expect(isDedicatedSwimEnvironment(dedicated)).toBe(true);
  });
  it("requires and matches the expected project reference", () => {
    expect(isDedicatedSwimEnvironment({ ...dedicated, SWIM_TEST_PROJECT_REF: undefined })).toBe(false);
    expect(isDedicatedSwimEnvironment({ ...dedicated, SWIM_TEST_PROJECT_REF: "project-b" })).toBe(false);
    expect(isDedicatedSwimEnvironment({ ...dedicated, SWIM_TEST_PROJECT_REF: "project-a" })).toBe(true);
  });
  it.each([
    "http://project-a.supabase.co", "https://user@project-a.supabase.co",
    "https://project-a.supabase.co:443", " https://project-a.supabase.co",
    "https://project-a.supabase.co:8443", "https://project-a.supabase.co/path",
    "https://project-a.supabase.co?query=1", "https://project-a.supabase.co#fragment",
  ])("rejects a noncanonical dedicated URL: %s", (url) => {
    expect(isDedicatedSwimEnvironment({ ...dedicated, E2E_SUPABASE_URL: url })).toBe(false);
    expect(isDedicatedSwimEnvironment({ ...dedicated, NEXT_PUBLIC_SUPABASE_URL: url })).toBe(false);
  });
  it("refuses a different application project or invalid dedicated URL", () => {
    expect(isDedicatedSwimEnvironment({ ...dedicated, NEXT_PUBLIC_SUPABASE_URL: "https://project-b.supabase.co" })).toBe(false);
    expect(isDedicatedSwimEnvironment({ ...dedicated, E2E_SUPABASE_URL: "invalid" })).toBe(false);
    expect(isDedicatedSwimEnvironment({ ...dedicated, NEXT_PUBLIC_SUPABASE_URL: "" })).toBe(false);
    expect(isDedicatedSwimEnvironment({ ...dedicated, NEXT_PUBLIC_SUPABASE_URL: dedicated.E2E_SUPABASE_URL })).toBe(true);
    expect(isDedicatedSwimEnvironment({ ...dedicated, NEXT_PUBLIC_SUPABASE_URL: `${dedicated.E2E_SUPABASE_URL}/` })).toBe(true);
  });
  it.each(["", "  ", "<anon-key>", "YOUR_ANON_KEY", "replace-me", "sb_publishable_placeholder_12345678901234567890"])("rejects placeholder credentials before fixtures: %s", (value) => {
    expect(isDedicatedSwimEnvironment({ ...dedicated, E2E_SUPABASE_ANON_KEY: value })).toBe(false);
    expect(swimE2EEnabled.bind(null, { ...dedicated, E2E_SUPABASE_ANON_KEY: value })).toThrow();
  });
  it("rejects credentials with surrounding or embedded whitespace", () => {
    expect(isDedicatedSwimEnvironment({ ...dedicated, E2E_SUPABASE_ANON_KEY: `${dedicated.E2E_SUPABASE_ANON_KEY} ` })).toBe(false);
    expect(isDedicatedSwimEnvironment({ ...dedicated, E2E_SUPABASE_SERVICE_ROLE_KEY: `${dedicated.E2E_SUPABASE_SERVICE_ROLE_KEY}\n` })).toBe(false);
  });
  it("skips only an unrequested run and fails requested invalid configuration loudly", () => {
    expect(swimE2EEnabled({})).toBe(false);
    expect(() => swimE2EEnabled({ E2E_SWIM_NONPROD: "1" })).toThrow();
    expect(() => swimE2EEnabled({ ...dedicated, E2E_SWIM_NONPROD: "true" })).toThrow();
    expect(swimE2EEnabled(dedicated)).toBe(true);
  });
  it("accepts legacy JWT-shaped keys as well as modern Supabase key formats", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
    const key = `${header}.${payload}.${"a".repeat(43)}`;
    expect(isDedicatedSwimEnvironment({ ...dedicated, E2E_SUPABASE_ANON_KEY: key, E2E_SUPABASE_SERVICE_ROLE_KEY: key })).toBe(true);
  });
});
