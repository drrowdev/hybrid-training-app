import { Socket } from "node:net";
import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rehearseStandaloneSwimOutcomes } from "../../integration-tests/swim-standalone-outcomes-rehearsal";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("DC-SW8 standalone outcome rehearsal boundary", () => {
  it.each(["not-ci", "not-linux", "remote", "port", "database", "pool"] as const)(
    "refuses %s before opening a database connection",
    async (mode) => {
      vi.stubEnv("GITHUB_ACTIONS", mode === "not-ci" ? "false" : "true");
      Object.defineProperty(process, "platform", { ...platform, value: mode === "not-linux" ? "win32" : "linux" });
      const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
        throw new Error("Unexpected database connection");
      });
      const sql = postgres({
        host: mode === "remote" ? "example.invalid" : "127.0.0.1",
        port: mode === "port" ? 5433 : 5432,
        database: mode === "database" ? "postgres" : "swim_migration_runner_fresh",
        username: "postgres", max: mode === "pool" ? 2 : 1,
      });
      const stage = vi.fn();
      try {
        await expect(rehearseStandaloneSwimOutcomes(sql, "BEGIN;\nCOMMIT;\n", stage))
          .rejects.toMatchObject({ code: "ERR_ASSERTION" });
        expect(connect).not.toHaveBeenCalled();
        expect(stage).not.toHaveBeenCalled();
      } finally {
        await sql.end();
      }
    },
  );
});
