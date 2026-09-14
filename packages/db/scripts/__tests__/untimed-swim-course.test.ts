import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const original = read("../../drizzle/0146_standalone_pool_swimming.sql");
const up = read("../../drizzle/0154_swim_untimed_courses.sql");
const down = read("../../rollbacks/0154_swim_untimed_courses.down.sql");
const body = (source: string, name: string) => {
  const match = source.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?END \\$\\$;`));
  if (!match) throw new Error(`Missing validator: ${name}`);
  return match[0].replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION");
};

describe("DC-SW3/SW5 untimed course migration", () => {
  it.each(["swim_validate_prescription", "swim_validate_plan"])("restores the exact previous %s validator", (name) => {
    expect(body(down, name)).toBe(body(original, name));
  });
  it.each([
    ["swim_validate_prescription", "p_workout->'budget'->'minutes'", 1],
    ["swim_validate_plan", "v_setup->'sessionBudgetMinutes'", 10],
  ] as const)("changes only the explicit-null budget branch in %s", (name, expression, minimum) => {
    const start = `  IF ${expression} IS NOT DISTINCT FROM 'null'::jsonb THEN`;
    const current = body(up, name);
    const begin = current.indexOf(start);
    const end = current.indexOf("\n  END IF;", begin) + "\n  END IF;".length;
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(current.slice(0, begin) + `  PERFORM public.swim_bounded_integer(${expression}, ${minimum}, 240);` + current.slice(end))
      .toBe(body(original, name));
  });
});
