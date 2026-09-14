import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptedReceipt } from "./deploy-swim-review";
import { OTHER_OPERATIONS, runRefreshCli, type RefreshProfile } from "./refresh-swim-review";

const previous = {
  run: "34675114561", sha: "da91ab606680d5436591d7fe51446f184147602e",
  id: "dpl_3vfgXX3bpYQ9BL5JhA6F8U3Qwy73",
  url: "hybrid-training-app-afdlerer6-drrowdevs-projects.vercel.app",
  start: Date.parse("2026-09-12T05:20:38Z"), end: Date.parse("2026-09-12T05:22:27Z"),
} as const;

export const READONLY_REVIEW_REFRESH: RefreshProfile = {
  reference: {
    sha: "1c082ee854c5b3e595ebf198b01f878e4d9fe39d", run: "34676255050", kind: "automatic_ci",
  },
  paths: [
    "packages/db/scripts/refresh-swim-readonly-review.ts",
    "packages/db/scripts/__tests__/refresh-swim-readonly-review.test.ts",
    "packages/db/scripts/refresh-swim-review.ts",
    "packages/db/scripts/__tests__/refresh-swim-review.test.ts",
    ".github/workflows/ci.yml", "docs/knowledge/log.md", "docs/knowledge/pool-swimming.md",
  ],
  operation: "REFRESH_SWIM_READONLY_REVIEW", job: "refresh-swim-readonly-review", scope: "swim-readonly-review-refresh",
  otherOperations: [...OTHER_OPERATIONS, "REFRESH_SWIM_REVIEW", "REFRESH_SWIM_PLAN_REVIEW"],
  previous,
  aliasUid: "bcb28e248512a31abb41a4c636e0a6350165115f2432b6e4cba8e469c48194af0087b087a511792f853550ea01e3b2c97246876450542c7823eb40e11b303aa1",
  receipt: (project, shared) => { acceptedReceipt(project, shared, true, previous); },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void runRefreshCli(READONLY_REVIEW_REFRESH);
