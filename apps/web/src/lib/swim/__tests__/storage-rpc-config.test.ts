import { describe, expect, it } from "vitest";
import { getSwimRpcTestEnv } from "./storage-rpc-config";

const configured = () => ({
  SWIM_RPC_TEST_NONPRODUCTION: "true",
  SWIM_TEST_PROJECT_REF: "pooltestfixture",
  SMOKE_SUPABASE_URL: "https://pooltestfixture.supabase.co",
  SMOKE_SUPABASE_ANON_KEY: "anonymous-credential-fixture",
  SMOKE_SUPABASE_SERVICE_ROLE_KEY: "administrator-credential-fixture",
});

describe("dedicated swim RPC target safety", () => {
  it("allows the same explicitly acknowledged test project as the web server", () => {
    expect(getSwimRpcTestEnv({
      ...configured(), NEXT_PUBLIC_SUPABASE_URL: configured().SMOKE_SUPABASE_URL,
    })).toEqual({
      url: configured().SMOKE_SUPABASE_URL,
      anonKey: configured().SMOKE_SUPABASE_ANON_KEY,
      serviceRoleKey: configured().SMOKE_SUPABASE_SERVICE_ROLE_KEY,
      projectRef: "pooltestfixture",
    });
  });

  it("trims all target and credential settings before returning them", () => {
    const env = configured();
    expect(getSwimRpcTestEnv({
      ...env,
      SWIM_TEST_PROJECT_REF: ` ${env.SWIM_TEST_PROJECT_REF}\n`,
      SMOKE_SUPABASE_URL: `\t${env.SMOKE_SUPABASE_URL} `,
      SMOKE_SUPABASE_ANON_KEY: ` ${env.SMOKE_SUPABASE_ANON_KEY}\r\n`,
      SMOKE_SUPABASE_SERVICE_ROLE_KEY: `\t${env.SMOKE_SUPABASE_SERVICE_ROLE_KEY} `,
    })).toEqual(getSwimRpcTestEnv(env));
  });

  it.each([
    "", " ", "\t\r\n", "<key>", "${SUPABASE_KEY}", "YOUR_TEST_KEY",
    "replace-me", "REPLACE_WITH_TEST_KEY", "paste-key-here", "changeme",
    "placeholder", "TODO", "TBD", "null", "undefined", "xxx", "...",
    "test-anon-key", "example-key", "sb_secret_REPLACE_ME", "sb_publishable_YOUR_KEY",
  ])("rejects empty or placeholder credentials before client creation: %s", (value) => {
    for (const key of ["SMOKE_SUPABASE_ANON_KEY", "SMOKE_SUPABASE_SERVICE_ROLE_KEY"]) {
      expect(() => getSwimRpcTestEnv({ ...configured(), [key]: value })).toThrow();
    }
  });

  it.each([" ", "<project-ref>", "YOUR_PROJECT_REF", "replace-me"])("rejects placeholder project reference: %s", (value) => {
    expect(() => getSwimRpcTestEnv({ ...configured(), SWIM_TEST_PROJECT_REF: value })).toThrow();
  });

  it.each([undefined, "false", "TRUE", "1"])("does nothing without exact acknowledgement: %s", (ack) => {
    expect(getSwimRpcTestEnv({ ...configured(), SWIM_RPC_TEST_NONPRODUCTION: ack })).toBeNull();
  });

  it.each(["SWIM_TEST_PROJECT_REF", "SMOKE_SUPABASE_URL", "SMOKE_SUPABASE_ANON_KEY", "SMOKE_SUPABASE_SERVICE_ROLE_KEY"])(
    "fails closed if %s is missing, without application credential fallbacks",
    (key) => {
      expect(() => getSwimRpcTestEnv({
        ...configured(), [key]: undefined,
        NEXT_PUBLIC_SUPABASE_URL: "https://unrelatedfixture.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "application-anon",
        SUPABASE_SERVICE_ROLE_KEY: "application-admin",
        DATABASE_URL: "application-database",
      })).toThrow();
    },
  );

  it.each([
    "https://differentfixture.supabase.co",
    "https://pooltestfixture.supabase.co.invalid.example",
    "https://pooltestfixture.supabase.co@differentfixture.supabase.co",
    "http://pooltestfixture.supabase.co",
    "https://pooltestfixture.supabase.co:8443",
    "https://user:password@pooltestfixture.supabase.co",
    "https://pooltestfixture.supabase.co/rest/v1",
    "https://pooltestfixture.supabase.co/?token=secret",
    "https://pooltestfixture.supabase.co/#fragment",
    "not a URL",
  ])("rejects a mismatched or ambiguous target: %s", (url) => {
    expect(() => getSwimRpcTestEnv({ ...configured(), SMOKE_SUPABASE_URL: url })).toThrow();
  });

  it("rejects malformed project references", () => {
    expect(() => getSwimRpcTestEnv({ ...configured(), SWIM_TEST_PROJECT_REF: "fixture.supabase.co" })).toThrow();
  });
});

describe("localhost-only swim RPC target mode", () => {
  const local = () => ({
    SWIM_RPC_TEST_NONPRODUCTION: "true",
    SWIM_RPC_TEST_LOCAL: "true",
    SWIM_TEST_PROJECT_REF: "local",
    SMOKE_SUPABASE_URL: "http://127.0.0.1:54321",
    SMOKE_SUPABASE_ANON_KEY: "anonymous-credential-fixture",
    SMOKE_SUPABASE_SERVICE_ROLE_KEY: "administrator-credential-fixture",
  });

  it("accepts a bare loopback origin acknowledged with SWIM_TEST_PROJECT_REF=local", () => {
    expect(getSwimRpcTestEnv(local())).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: local().SMOKE_SUPABASE_ANON_KEY,
      serviceRoleKey: local().SMOKE_SUPABASE_SERVICE_ROLE_KEY,
      projectRef: "local",
    });
  });

  it.each(["localhost", "[::1]"])("accepts other loopback hostnames: %s", (hostname) => {
    expect(getSwimRpcTestEnv({ ...local(), SMOKE_SUPABASE_URL: `http://${hostname}:54321` })?.url)
      .toBe(`http://${hostname}:54321`);
  });

  it("does not activate local mode without the exact SWIM_RPC_TEST_LOCAL flag", () => {
    expect(() => getSwimRpcTestEnv({ ...local(), SWIM_RPC_TEST_LOCAL: undefined })).toThrow();
    expect(() => getSwimRpcTestEnv({ ...local(), SWIM_RPC_TEST_LOCAL: "1" })).toThrow();
  });

  it("still requires the exact SWIM_RPC_TEST_NONPRODUCTION acknowledgement", () => {
    expect(getSwimRpcTestEnv({ ...local(), SWIM_RPC_TEST_NONPRODUCTION: "false" })).toBeNull();
  });

  it("rejects any non-'local' project reference in local mode, even a real-looking one", () => {
    expect(() => getSwimRpcTestEnv({ ...local(), SWIM_TEST_PROJECT_REF: "pooltestfixture" })).toThrow();
  });

  it.each([
    "https://127.0.0.1:54321", // not http
    "http://example.com:54321", // not loopback
    "http://127.0.0.1:54321/rest/v1", // path
    "http://127.0.0.1:54321?token=1", // query
    "http://127.0.0.1:54321#frag", // fragment
    "http://user:pass@127.0.0.1:54321", // credentials
    "not a URL",
  ])("rejects a widened localhost target: %s", (url) => {
    expect(() => getSwimRpcTestEnv({ ...local(), SMOKE_SUPABASE_URL: url })).toThrow();
  });

  it("never lets a hosted supabase.co URL through local mode", () => {
    expect(() => getSwimRpcTestEnv({ ...local(), SMOKE_SUPABASE_URL: "https://pooltestfixture.supabase.co" })).toThrow();
  });

  it("keeps the hosted mode's own guard behavior unaffected by SWIM_RPC_TEST_LOCAL being absent", () => {
    expect(getSwimRpcTestEnv(configured())).not.toBeNull();
  });
});
