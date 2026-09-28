import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DC-K4: additive resume migration preserves existing schedule cases", () => {
  it("pins the original function and inserts only the new branch", () => {
    const original = readFileSync(new URL("../../drizzle/0156_modular_training_schedule.sql", import.meta.url), "utf8")
      .replaceAll("\r\n", "\n");
    const up = readFileSync(new URL("../../drizzle/0162_resume_ended_program.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const down = readFileSync(new URL("../../rollbacks/0162_resume_ended_program.down.sql", import.meta.url), "utf8");
    const functionText = original.split("CREATE FUNCTION public.training_schedule_commit(")[1]!.split("END $$;")[0]! + "END ";
    const body = functionText.split("AS $$")[1]!;
    const fingerprint = createHash("md5").update(body).digest("hex");
    expect(up).toContain(fingerprint);
    expect(down).toContain(fingerprint);
    const addition = up.split("$resume$")[1]!;
    const changed = body.replace("    WHEN 'primary-end' THEN", addition);
    expect(changed).not.toBe(body);
    expect(changed.replace(/    -- 0162 primary-resume begin[\s\S]*?    -- 0162 primary-resume end\n/, "")).toBe(body);
    expect(addition).not.toMatch(/(?:UPDATE|DELETE FROM) public\.planned_sessions/);
  });
});
