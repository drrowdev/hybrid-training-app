/**
 * Eval-harness matchers.
 *
 * Three structural matchers (ADR 0002 § Eval harness). All return
 * `{ ok: true } | { ok: false, errors: string[] }` so the runner can
 * collect and report every failure for a fixture instead of stopping
 * at the first.
 *
 * Intentionally NOT a regex-on-prose matcher — we assert behaviour
 * (shape, presence, order), not specific wording.
 */

export type MatcherResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * `assertResponseShape` — verify the response is an object containing
 * every required key whose value passes the predicate. `spec` is a
 * map of key → predicate.
 */
export function assertResponseShape(
  response: unknown,
  spec: Record<string, (value: unknown) => boolean>,
): MatcherResult {
  if (!response || typeof response !== "object") {
    return { ok: false, errors: ["response is not an object"] };
  }
  const obj = response as Record<string, unknown>;
  const errors: string[] = [];
  for (const [key, pred] of Object.entries(spec)) {
    if (!(key in obj)) {
      errors.push(`missing required key: ${key}`);
      continue;
    }
    if (!pred(obj[key])) {
      errors.push(`key failed predicate: ${key}`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * `assertElementRules` — verify structural rules on a list-shaped
 * response. Each rule names a path (dot-delimited) and a `mustContain`
 * value the path's resolved value must include (string substring, or
 * array element).
 */
export type ElementRule = {
  path: string;
  mustContain?: string;
  mustNotContain?: string;
  minLength?: number;
};

function resolvePath(obj: unknown, dotPath: string): unknown {
  return dotPath
    .split(".")
    .reduce<
      unknown
    >((acc, key) => {
      if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
}

export function assertElementRules(
  response: unknown,
  rules: ElementRule[],
): MatcherResult {
  const errors: string[] = [];
  for (const rule of rules) {
    const v = resolvePath(response, rule.path);
    if (rule.mustContain !== undefined) {
      const ok =
        (typeof v === "string" && v.includes(rule.mustContain)) ||
        (Array.isArray(v) && v.includes(rule.mustContain));
      if (!ok) errors.push(`${rule.path}: missing required element "${rule.mustContain}"`);
    }
    if (rule.mustNotContain !== undefined) {
      const bad =
        (typeof v === "string" && v.includes(rule.mustNotContain)) ||
        (Array.isArray(v) && v.includes(rule.mustNotContain));
      if (bad) errors.push(`${rule.path}: contains forbidden element "${rule.mustNotContain}"`);
    }
    if (rule.minLength !== undefined) {
      const len =
        typeof v === "string" || Array.isArray(v) ? v.length : -1;
      if (len < rule.minLength)
        errors.push(`${rule.path}: minLength ${rule.minLength} not met (got ${len})`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * `assertOrdering` — verify that a sequence of string markers appears
 * in the named order at the given path. Useful when ordering carries
 * meaning (e.g., the "why" must precede the "what" in a deload
 * explanation).
 */
export function assertOrdering(
  response: unknown,
  ordering: { path: string; sequence: string[] },
): MatcherResult {
  const v = resolvePath(response, ordering.path);
  if (typeof v !== "string" && !Array.isArray(v)) {
    return { ok: false, errors: [`${ordering.path}: not a string or array`] };
  }
  let lastIndex = -1;
  for (const marker of ordering.sequence) {
    let foundAt = -1;
    if (typeof v === "string") foundAt = v.indexOf(marker, lastIndex + 1);
    else
      foundAt = v.findIndex(
        (el, idx) => idx > lastIndex && el === marker,
      );
    if (foundAt === -1) {
      return {
        ok: false,
        errors: [
          `${ordering.path}: marker "${marker}" not found after position ${lastIndex}`,
        ],
      };
    }
    lastIndex = foundAt;
  }
  return { ok: true };
}
