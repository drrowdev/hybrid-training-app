import { acceptanceAssert as assert } from "./swim-acceptance-errors";

export type BrowserCase = Readonly<{ file: string; describe: string; title: string }>;
export const MODULAR_MIGRATION_TOTAL = 159;
export const MODULAR_BROWSER_CASES: readonly BrowserCase[] = Object.freeze([
  "M1 DC-K4: strength creation retains library identities through reload and logging",
  "M2 DC-K4: running setup and future edits retain typed prescriptions",
  "M3 DC-K4: hybrid repeats and activity views retain one workout identity",
  "M4 DC-SW7: swimming coexists with reviewed primary commitments and independent lifecycle",
  "M5 DC-K4: stale schedule review and retried saves preserve one accepted program",
  "M6 DC-SW8: two users cannot read or change each other's programs",
  "M7 DC-SW5: explicit imported outcomes stay consistent across training views and retained history",
  "M8 DC-K4: legacy refusal preserves drafts and history until the owner explicitly ends it",
  "M9 DC-K4/DC-SW7: three independent two-day programs share an explicitly accepted date",
  "M10 DC-K4/DC-SW7: fourth Hybrid and same-type replacement preserve peer edits",
  "M11 DC-K4/DC-SW7: trash restore and a shorter program ending preserve the longer calendars",
  "M12 DC-K4: shared measurements and Hybrid load setup preserve Strength targets",
  "M13 DC-R5/DC-SW7: shared rehab attaches through Running and Swimming and logs without a swim result",
  "M14 DC-R5/DC-SW7: Swimming pause moves only its dates and retains issued rehab",
  "M15 DC-K4/DC-SW8: app replacement preserves unfinished work and queued completion identities",
  "M16 DC-K4/DC-SW8: independent completion exports retained history without fabricated swim results",
  "M17 DC-K4: completed advice and roadmap continuation survive a stale save and exact replay",
  "M18 DC-K4: an unrelated unlinked program save leaves the full roadmap unchanged",
].map((title) => Object.freeze({
  file: "e2e/program-builder-mobile.spec.ts", describe: "Modular program builder", title,
})));

export function isModularBrowserProfile(env: Readonly<Record<string, string | undefined>>) {
  assert(env.SXC_ACCEPTANCE_PROFILE === undefined || ["swimming", "modular"].includes(env.SXC_ACCEPTANCE_PROFILE),
    "Unexpected acceptance profile");
  return env.SXC_ACCEPTANCE_PROFILE === "modular";
}

export function isModularAcceptance(env: Readonly<Record<string, string | undefined>>) {
  if (!isModularBrowserProfile(env)) return false;
  assert((env.GITHUB_REF === "refs/heads/drrowdev-modular-programs-implementation" ||
    env.GITHUB_REF === "refs/heads/drrowdev-programs-page-redesign" ||
    env.GITHUB_REF === "refs/heads/drrowdev-swimming-test-suite-repair") &&
    env.GITHUB_RUN_ATTEMPT === "1", "Modular acceptance requires its reviewed branch and first attempt");
  return true;
}

export function isModularSchemaAcceptance(env: Readonly<Record<string, string | undefined>>) {
  isModularAcceptance(env);
  const reviewed = env.GITHUB_REF === "refs/heads/drrowdev-modular-programs-implementation" ||
    env.GITHUB_REF === "refs/heads/drrowdev-programs-page-redesign" ||
    env.GITHUB_REF === "refs/heads/drrowdev-swimming-test-suite-repair";
  if (reviewed) assert(env.GITHUB_RUN_ATTEMPT === "1",
    "Modular schema qualification requires its reviewed branch and first attempt");
  return reviewed;
}
