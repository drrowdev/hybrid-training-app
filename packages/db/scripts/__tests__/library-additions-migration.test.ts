import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOVEMENT_INSTRUCTIONS } from "../../seeds/movement-instructions";
import { SEED_MOVEMENTS } from "../../seeds/movements";
import { PATTERNS_PART_4 } from "../../seeds/movements-part4";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");

describe("library additions (0170)", () => {
  const up = read("../../drizzle/0170_library_additions.sql");
  const down = read("../../rollbacks/0170_library_additions.down.sql");
  const seeded = PATTERNS_PART_4.map((m) => m.slug);

  it("inserts exactly the movements and how-to text in the seed", () => {
    const inserted = [...up.matchAll(/VALUES \(\n  NULL, '([^']+)'/g)].map((m) => m[1]);
    const instructed = [...up.matchAll(/WHERE user_id IS NULL AND slug = '([^']+)'\nON CONFLICT \(movement_id\)/g)].map((m) => m[1]);
    expect(inserted.sort()).toEqual([...seeded].sort());
    expect(instructed.sort()).toEqual([...seeded].sort());
  });

  it("never overwrites an existing catalog row", () => {
    expect(up.match(/ON CONFLICT \(user_id, slug\) DO NOTHING/g)).toHaveLength(seeded.length);
    expect(up).not.toMatch(/DO UPDATE|DELETE FROM/);
  });

  it("gives every new movement how-to text", () => {
    const missing = seeded.filter((slug) => !MOVEMENT_INSTRUCTIONS.some((i) => i.slug === slug));
    expect(missing).toEqual([]);
  });

  it("files push-up variations under the press pattern with the push-up", () => {
    const bySlug = new Map(SEED_MOVEMENTS.map((m) => [m.slug, m]));
    expect(bySlug.get("push-up")?.pattern).toBe("press");
    expect(bySlug.get("push-up-neutral-grip-deficit")?.displayName).toBe("Deficit Neutral-Grip Push-Up");
    expect(bySlug.get("push-up-clap")?.bulletproofRoles ?? []).not.toContain("plyometric_low");
  });

  it("refuses the rollback while a movement is referenced", () => {
    expect(down).toContain("ERRCODE = '55000'");
    for (const slug of seeded) expect(down).toContain(`'${slug}'`);
  });
});
