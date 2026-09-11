import { describe, expect, it, vi } from "vitest";
import { OTHER_OPERATIONS, REFRESH_PATHS, REFRESH_REFERENCE, refreshArguments, refreshContext, verifyRefreshSource,
  refreshTransport } from "../../packages/db/scripts/refresh-swim-review";
import { BASE_SHA, updateRoute } from "../../packages/db/scripts/deploy-swim-review";
import { ROUTES } from "../../packages/db/scripts/configure-swim-review";
import { REVIEW } from "../../packages/db/scripts/swim-review-config-plan";

const sha = "b".repeat(40);
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF_TYPE: "branch", GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_JOB: "refresh-swim-review",
  GITHUB_SHA: sha, EXPECTED_SHA: sha, REFRESH_SWIM_REVIEW: "true",
  ...Object.fromEntries(OTHER_OPERATIONS.map((key) => [key, "false"])),
};
function sourceIO() {
  return {
    regular: () => true,
    event: () => ({ inputs: { refresh_swim_review: "true", expected_sha: sha,
      ...Object.fromEntries(OTHER_OPERATIONS.map((key) => [key.toLowerCase(), "false"])) } }),
    git: vi.fn((...args: string[]) => {
      if (args[0] === "rev-parse") return sha;
      if (args[0] === "status" || args[0] === "merge-base") return "";
      if (args[0] === "diff") return REFRESH_PATHS.join("\n");
      if (args[0] === "ls-tree") return REFRESH_PATHS.map((path) => `100644 blob ${sha}\t${path}`).join("\n");
      if (args[0] === "ls-remote") return `${args[3] === "refs/heads/main" ? BASE_SHA : sha}\t${args[3]}`;
      throw Error("offline_canary");
    }),
  };
}
describe("bounded refresh source and transport", () => {
  it("uses a separate accepted-source guard and strict CLI", () => {
    const io = sourceIO();
    verifyRefreshSource(env, io);
    expect(io.git).toHaveBeenCalledWith("merge-base", "--is-ancestor", REFRESH_REFERENCE.sha, "HEAD");
    expect(refreshArguments([])).toBe(false);
    expect(refreshArguments(["--check-source"])).toBe(true);
    for (const args of [["--deploy"], ["--check-source", "--check-source"], ["--check-source", "x"]]) {
      expect(() => refreshArguments(args)).toThrow();
    }
  });
  it.each([...OTHER_OPERATIONS, "GITHUB_JOB", "GITHUB_SHA", "EXPECTED_SHA", "GITHUB_REF", "GITHUB_REPOSITORY",
    "GITHUB_EVENT_NAME", "GITHUB_REF_TYPE", "GITHUB_ACTIONS", "REFRESH_SWIM_REVIEW"])("rejects missing or mixed %s", (key) => {
    expect(() => refreshContext({ ...env, [key]: undefined })).toThrow();
    expect(() => refreshContext({ ...env, [key]: "wrong" })).toThrow();
  });
  it.each(["diff", "status", "rev-parse", "ls-tree", "ls-remote", "merge-base", "regular", "event"])("refuses %s drift", (kind) => {
    const io = sourceIO();
    const original = io.git.getMockImplementation()!;
    io.git.mockImplementation((...args) => {
      if (args[0] === kind) { if (kind === "merge-base") throw Error("offline_canary"); return "wrong"; }
      return original(...args);
    });
    if (kind === "regular") io.regular = () => false;
    if (kind === "event") io.event = () => ({ inputs: { refresh_swim_review: "false", expected_sha: sha } });
    expect(() => verifyRefreshSource(env, io)).toThrow();
  });
  it.each([
    ["https://api.vercel.com/v2/user", "GET", undefined],
    [ROUTES.auth, "PATCH", {}], [ROUTES.storage, "POST", { sql: "forbidden" }],
    [updateRoute("POOL_SWIMMING_ENABLED"), "PATCH", {}],
    [ROUTES.project_env.replace("decrypt=false", "decrypt=true"), "GET", undefined],
    [ROUTES.project, "DELETE", undefined], [ROUTES.project, "GET", {}],
    [ROUTES.storage.replace("swim_storage_ready", "other"), "POST", {}],
  ])("denies unapproved request %s %s", async (url, method, body) => {
    const fetcher = vi.fn<typeof fetch>();
    const request = refreshTransport(env, Date.now() + 60_000, fetcher);
    await expect(request(String(url), String(method), body)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
