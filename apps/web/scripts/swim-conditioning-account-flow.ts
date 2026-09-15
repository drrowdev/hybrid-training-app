import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accountFlowMain, type AccountFlowConfiguration } from "./swim-account-flow";
import { conditioningAccountFlow, conditioningChecks } from "./swim-conditioning-account-flow-browser";
import { repairedConditioningAccountProfile, checkConditioningAccountDispatch,
  conditioningAccountAbsenceQuery } from "../../../packages/db/scripts/swim-conditioning-account-flow-guards";
import { CONDITIONING_REVIEW_FLAGS } from "../../../packages/db/scripts/update-conditioning-swim-review";
import { inspectIdentityReview } from "../../../packages/db/scripts/conditioning-identity-review-storage";

export const CONDITIONING_ACCOUNT_FLOW = repairedConditioningAccountProfile();
const configuration: AccountFlowConfiguration = {
  profile: CONDITIONING_ACCOUNT_FLOW, scope: "swim-conditioning-account-flow",
  marker: "SWIM_CONDITIONING_ACCOUNT_FLOW", dispatch: checkConditioningAccountDispatch,
  absence: conditioningAccountAbsenceQuery,
  ledger: (sql) => inspectIdentityReview(sql, 159),
  flags: CONDITIONING_REVIEW_FLAGS, flow: conditioningAccountFlow, checks: conditioningChecks,
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void accountFlowMain(configuration);
