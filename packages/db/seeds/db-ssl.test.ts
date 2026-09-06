import { describe, expect, it } from "vitest";
import { resolveSeedSsl } from "./db-ssl";

const LOOPBACK_URL = "postgres://postgres:postgres@127.0.0.1:54322/postgres";
const LOCALHOST_URL = "postgres://postgres:postgres@localhost:54322/postgres";
const IPV6_LOOPBACK_URL = "postgres://postgres:postgres@[::1]:54322/postgres";
const HOSTED_URL = "postgres://postgres:postgres@db.pooltestfixture.supabase.co:5432/postgres";

describe("resolveSeedSsl", () => {
  it("defaults to requiring TLS with no PGSSLMODE, for any host", () => {
    expect(resolveSeedSsl(HOSTED_URL, undefined)).toBe("require");
    expect(resolveSeedSsl(LOOPBACK_URL, undefined)).toBe("require");
  });

  it("honors an explicit verify-full choice regardless of host", () => {
    expect(resolveSeedSsl(HOSTED_URL, "verify-full")).toBe(true);
    expect(resolveSeedSsl(LOOPBACK_URL, "verify-full")).toBe(true);
  });

  it("disables TLS only for a loopback host with explicit PGSSLMODE=disable", () => {
    expect(resolveSeedSsl(LOOPBACK_URL, "disable")).toBe(false);
    expect(resolveSeedSsl(LOCALHOST_URL, "disable")).toBe(false);
    expect(resolveSeedSsl(IPV6_LOOPBACK_URL, "disable")).toBe(false);
  });

  it("never disables TLS for a non-loopback host, even with PGSSLMODE=disable", () => {
    expect(resolveSeedSsl(HOSTED_URL, "disable")).toBe("require");
  });

  it("ignores unrecognized PGSSLMODE values and keeps the safe default", () => {
    expect(resolveSeedSsl(LOOPBACK_URL, "allow")).toBe("require");
    expect(resolveSeedSsl(LOOPBACK_URL, "")).toBe("require");
  });

  it("treats an unparsable DATABASE_URL as non-loopback", () => {
    expect(resolveSeedSsl("not a url", "disable")).toBe("require");
  });
});
