import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptedReceipt } from "./deploy-swim-review";
import { OTHER_OPERATIONS, runRefreshCli, type RefreshProfile } from "./refresh-swim-review";

const previous = {
  run: "34625326276", sha: "abbd6583ef0dc459f8ae7cee4dd728a98d85d0d7",
  id: "dpl_8Y5MZiTJPBpYuZviFh3azJdkK6Xj",
  url: "hybrid-training-app-arqdi4e2y-drrowdevs-projects.vercel.app",
  start: Date.parse("2026-09-11T17:06:26Z"), end: Date.parse("2026-09-11T17:08:25Z"),
} as const;

export const PLAN_REVIEW_REFRESH: RefreshProfile = {
  reference: { sha: "c1f25d2b2704d710f83c1e5be2d14839d1a545fe", run: "34645293193" },
  paths: [
    "packages/db/scripts/refresh-swim-plan-review.ts",
    "packages/db/scripts/__tests__/refresh-swim-plan-review.test.ts",
    "packages/db/scripts/refresh-swim-review.ts",
    "packages/db/scripts/__tests__/refresh-swim-review.test.ts",
    "packages/db/scripts/deploy-swim-review.ts",
    "packages/db/scripts/__tests__/deploy-swim-review.test.ts",
    ".github/workflows/ci.yml", "docs/knowledge/log.md", "docs/knowledge/pool-swimming.md",
  ],
  operation: "REFRESH_SWIM_PLAN_REVIEW", job: "refresh-swim-plan-review", scope: "swim-plan-review-refresh",
  otherOperations: [...OTHER_OPERATIONS, "REFRESH_SWIM_REVIEW"],
  previous,
  aliasUid: "bcb28e248512a31abb41a4c636e0a6350165115f2432b6e4cba8e469c48194af0087b087a511792f853550ea01e3b2c97246876450542c7823eb40e11b303aa1",
  receipt: (project, shared) => { acceptedReceipt(project, shared, true, previous); },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void runRefreshCli(PLAN_REVIEW_REFRESH);
