import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accountFlowMain, type AccountFlowConfiguration } from "./swim-account-flow";
import { conditioningAccountFlow, conditioningChecks } from "./swim-conditioning-account-flow-browser";
import { conditioningAccountProfile, checkConditioningAccountDispatch,
  conditioningAccountAbsenceQuery } from "../../../packages/db/scripts/swim-conditioning-account-flow-guards";
import { CONDITIONING_REVIEW_FLAGS } from "../../../packages/db/scripts/update-conditioning-swim-review";
import { conditioningReviewMigrations, inspectConditioningLedger } from "../../../packages/db/scripts/conditioning-swim-review-storage";

export const CONDITIONING_ACCOUNT_FLOW = conditioningAccountProfile({
  run: "34952341296", sha: "9d42be34302fd194e8fca0224db9fea88226fd8e",
  id: "dpl_BiNzLA4dsCDBqe3TjT8D5zhcC28V",
  url: "hybrid-training-app-gs6wfpekz-drrowdevs-projects.vercel.app",
  start: Date.parse("2026-09-15T09:29:50Z"), end: Date.parse("2026-09-15T09:32:28Z"),
  flags: { SWIM_CONDITIONING_ENABLED: "Yswvr3T3SVhNG3sC", SWIM_IMPORT_OUTCOMES_ENABLED: "oSElR8kMKssKapHu" },
});
const configuration: AccountFlowConfiguration = {
  profile: CONDITIONING_ACCOUNT_FLOW, scope: "swim-conditioning-account-flow",
  marker: "SWIM_CONDITIONING_ACCOUNT_FLOW", dispatch: checkConditioningAccountDispatch,
  absence: conditioningAccountAbsenceQuery,
  ledger: (sql) => inspectConditioningLedger(sql, conditioningReviewMigrations(), 158),
  flags: CONDITIONING_REVIEW_FLAGS, flow: conditioningAccountFlow, checks: conditioningChecks,
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void accountFlowMain(configuration);
