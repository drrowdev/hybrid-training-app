import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8").replaceAll("\r\n", "\n");
const up = read("drizzle/0158_conditioning_request_identity.sql");
const down = read("rollbacks/0158_conditioning_request_identity.down.sql");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const targets = [
  ["deploy_program_instance_atomically", "0144_atomic_user_workflows"],
  ["swim_conditioning_replay", "0156_atomic_swim_conditioning"],
  ["deploy_program_with_swimming", "0156_atomic_swim_conditioning"],
  ["swim_change_conditioning", "0157_swim_conditioning_lifecycle"],
  ["swim_lock_conditioning_program", "0157_swim_conditioning_lifecycle"],
];
describe("DC-SW8 existing identity helper for restricted conditioning", () => {
  it.each(targets)("pins and restores only the identity calls in %s", (name, file) => {
    const source = read(`drizzle/${file}.sql`);
    const body = new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*?\\bAS \\$\\$([\\s\\S]*?)\\$\\$;`)
      .exec(source)![1]!;
    expect(body).toContain("auth.uid()");
    expect(body).not.toContain("public.swim_request_user_id()");
    const repaired = body.replaceAll("auth.uid()", "public.swim_request_user_id()");
    for (const migration of [up, down]) {
      expect(migration).toContain(`'${hash(body)}'`);
      expect(migration).toContain(`'${hash(repaired)}'`);
    }
    expect(repaired.replaceAll("public.swim_request_user_id()", "auth.uid()")).toBe(body);
  });
  it("preserves owners, ACLs, invoker/definer mode and row security without broad grants", () => {
    expect(up.match(/'public\.[a-z_]+\([^']*\)',/g)).toHaveLength(5);
    for (const migration of [up, down]) {
      expect(migration).toContain("to_jsonb(before_proc) - 'prosrc' IS DISTINCT FROM to_jsonb(after_proc) - 'prosrc'");
      expect(migration).not.toMatch(/(?:GRANT|REVOKE).*ON SCHEMA|ALTER.*POLICY|BYPASSRLS|DELETE FROM|UPDATE public\./);
    }
    expect(up).toContain("GRANT EXECUTE ON FUNCTION public.swim_request_user_id() TO conditioning_writer");
    expect(down).toContain("REVOKE EXECUTE ON FUNCTION public.swim_request_user_id() FROM conditioning_writer");
  });
});
