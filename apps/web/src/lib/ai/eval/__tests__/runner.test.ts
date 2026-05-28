import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { runFixture, replay, type EvalFixture } from "../runner";

const PLACEHOLDER_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

const placeholderFixture: EvalFixture = {
  name: "placeholder",
  promptHash: PLACEHOLDER_HASH,
  matchers: {
    shape: { summary: "string", elements: "array" },
    elementRules: [{ path: "elements", mustContain: "ok" }],
  },
};

describe("eval runner — replay", () => {
  it("the placeholder fixture file on disk parses", async () => {
    const file = path.resolve(
      __dirname,
      "..",
      "fixtures",
      "_placeholder.json",
    );
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { promptHash: string };
    expect(parsed.promptHash).toBe(PLACEHOLDER_HASH);
  });

  it("runs the placeholder fixture against its checked-in cassette", async () => {
    const r = await runFixture(placeholderFixture, { mode: "replay" });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("convenience replay.runFixture matches the same path", async () => {
    const r = await replay.runFixture(placeholderFixture);
    expect(r.ok).toBe(true);
  });

  it("reports a clean failure when no cassette exists", async () => {
    const r = await runFixture(
      { ...placeholderFixture, promptHash: "deadbeef" },
      { mode: "replay" },
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/no cassette/);
  });

  it("rejects non-replay modes — strict + refresh are PR 2 stubs", async () => {
    await expect(
      runFixture(placeholderFixture, { mode: "strict" }),
    ).rejects.toThrow(/replay/);
    await expect(
      runFixture(placeholderFixture, { mode: "refresh" }),
    ).rejects.toThrow(/replay/);
  });
});
