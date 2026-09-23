import { acceptanceAssert as assert } from "./swim-acceptance-errors";

export type BrowserCase = Readonly<{ file: string; describe: string; title: string }>;
export const MODULAR_MIGRATION_TOTAL = 158;
export const MODULAR_BROWSER_CASES: readonly BrowserCase[] = Object.freeze([
  "M1 DC-K4: strength creation retains library identities through reload and logging",
  "M2 DC-K4: running setup and future edits retain typed prescriptions",
  "M3 DC-K4: hybrid repeats and activity views retain one workout identity",
  "M4 DC-SW7: swimming coexists with reviewed primary commitments and independent lifecycle",
  "M5 DC-K4: stale schedule review and retried saves preserve one accepted program",
  "M6 DC-SW8: two users cannot read or change each other's programs",
  "M7 DC-SW5: explicit imported outcomes stay consistent across training views and retained history",
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
  assert(env.GITHUB_REF === "refs/heads/drrowdev-modular-programs-implementation" &&
    env.GITHUB_RUN_ATTEMPT === "1", "Modular acceptance requires its reviewed branch and first attempt");
  return true;
}
