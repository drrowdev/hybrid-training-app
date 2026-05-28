/**
 * Eval-harness runner — replay mode only in PR 1.
 *
 * A fixture names a prompt hash and a set of matchers. The runner
 * loads the cassette for that hash and asserts the recorded response
 * passes every matcher. Strict mode (detect prompt drift) and refresh
 * mode (live call + cassette write) ship in PR 2.
 */
import { loadCassette, type CassetteRecord } from "./cassette";
import {
  assertElementRules,
  assertOrdering,
  assertResponseShape,
  type ElementRule,
  type MatcherResult,
} from "./matchers";

export type FixtureMatchers = {
  shape?: Record<string, "string" | "array" | "object" | "number" | "boolean">;
  elementRules?: ElementRule[];
  ordering?: { path: string; sequence: string[] };
};

export type EvalFixture = {
  name: string;
  promptHash: string;
  matchers: FixtureMatchers;
};

export type EvalRunResult = {
  fixture: string;
  ok: boolean;
  errors: string[];
};

function shapePredicate(kind: "string" | "array" | "object" | "number" | "boolean") {
  switch (kind) {
    case "string":
      return (v: unknown) => typeof v === "string";
    case "array":
      return (v: unknown) => Array.isArray(v);
    case "object":
      return (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
    case "number":
      return (v: unknown) => typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return (v: unknown) => typeof v === "boolean";
  }
}

function applyMatchers(
  response: unknown,
  matchers: FixtureMatchers,
): MatcherResult {
  const errors: string[] = [];
  if (matchers.shape) {
    const spec: Record<string, (v: unknown) => boolean> = {};
    for (const [k, kind] of Object.entries(matchers.shape)) {
      spec[k] = shapePredicate(kind);
    }
    const r = assertResponseShape(response, spec);
    if (!r.ok) errors.push(...r.errors);
  }
  if (matchers.elementRules?.length) {
    const r = assertElementRules(response, matchers.elementRules);
    if (!r.ok) errors.push(...r.errors);
  }
  if (matchers.ordering) {
    const r = assertOrdering(response, matchers.ordering);
    if (!r.ok) errors.push(...r.errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export type RunOptions = {
  mode: "replay" | "strict" | "refresh";
};

/**
 * Replay-only entry point. `strict` / `refresh` modes throw — they
 * are stub points for PR 2. The eval harness MUST NOT call any real
 * LLM in PR 1.
 */
export async function runFixture(
  fixture: EvalFixture,
  options: RunOptions,
): Promise<EvalRunResult> {
  if (options.mode !== "replay") {
    throw new Error(
      `eval runner: only "replay" mode is supported in PR 1 (got "${options.mode}"). ` +
        "strict + refresh ship with the orchestrator in PR 2.",
    );
  }
  const cassette = await loadCassette(fixture.promptHash);
  if (!cassette) {
    return {
      fixture: fixture.name,
      ok: false,
      errors: [`no cassette for promptHash=${fixture.promptHash}`],
    };
  }
  const result = applyMatchers(cassette.response, fixture.matchers);
  return {
    fixture: fixture.name,
    ok: result.ok,
    errors: result.ok ? [] : result.errors,
  };
}

/** Convenience export used by tests. */
export const replay = {
  loadCassette,
  runFixture: (fixture: EvalFixture) => runFixture(fixture, { mode: "replay" }),
};

export type { CassetteRecord };
