import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../../../..");
const checker = path.join(root, "scripts/check-commit-identities.mjs");
const hook = readFileSync(path.join(root, ".husky/pre-push"), "utf8");
const bot = "223556219+Copilot@users.noreply.github.com";
const human = "280348738+drrowdev@users.noreply.github.com";
const bad = "198982749+Copilot@users.noreply.github.com";
const zero = "0".repeat(40);
let dir: string;
let repo: string;
let remote: string;
let base: string;
let env: NodeJS.ProcessEnv;

function gitOutput(...args: string[]) {
  return execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function git(...args: string[]) {
  return gitOutput(...args).trim();
}

function commit(author = bot, committer = bot) {
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture"], {
    cwd: repo,
    env: { ...env, GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: committer },
    stdio: "pipe",
  });
  return git("rev-parse", "HEAD");
}

function rawCommit(author: string, committer: string, extraHeaders = "") {
  const content = `tree ${git("rev-parse", "HEAD^{tree}")}\nparent ${git("rev-parse", "HEAD")}\nauthor Fixture <${author}> 1700000000 +0000\ncommitter Fixture <${committer}> 1700000000 +0000\n${extraHeaders}\nfixture\n`;
  const sha = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
    cwd: repo, env, encoding: "utf8", input: content, stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  expect(gitOutput("cat-file", "commit", sha)).toBe(content);
  expect(gitOutput("show", "--no-show-signature", "-s", "--format=%ae%n%ce", sha, "--")).toBe(`${author}\n${committer}\n`);
  git("update-ref", "HEAD", sha);
  return sha;
}

function publishObjects() {
  git("--git-dir", remote, "fetch", "--no-tags", repo, "+refs/heads/*:refs/heads/*");
}

function runCI(eventName: string, event: object, head = git("rev-parse", "HEAD"), ref = "refs/heads/feature") {
  const eventPath = path.join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(event));
  return spawnSync(process.execPath, [checker, "ci"], {
    cwd: repo, encoding: "utf8",
    env: { ...env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: head, GITHUB_REF: ref },
  });
}

function pushEvent(before: string, after: string) {
  return runCI("push", { ref: "refs/heads/feature", before, after });
}

function prePush(input: string) {
  return spawnSync(process.execPath, [checker, "pre-push", remote], { cwd: repo, env, encoding: "utf8", input });
}

function update(head: string, old = zero, name = "feature") {
  return `refs/heads/${name} ${head} refs/heads/${name} ${old}\n`;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "commit-identities-"));
  repo = path.join(dir, "source");
  remote = path.join(dir, "remote.git");
  mkdirSync(repo);
  env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture", GIT_COMMITTER_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: bot, GIT_COMMITTER_EMAIL: bot,
  };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[key];
  git("init", "-b", "main");
  git("init", "--bare", "-b", "main", remote);
  git("remote", "add", "origin", remote);
  base = commit(human);
  publishObjects();
  git("checkout", "-b", "feature");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("commit identity guard", () => {
  it("rejects an older bad author despite a good newest commit across the whole push", () => {
    const older = commit(bad);
    const head = commit();
    publishObjects();
    const result = pushEvent(base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${older}: disallowed author`);
    expect(result.stderr).not.toContain(bad);
    expect(result.stderr).not.toContain("fixture");
  });

  it("rejects a bad committer independently", () => {
    const head = commit(bot, bad);
    publishObjects();
    expect(pushEvent(base, head).stderr).toContain(`${head}: disallowed committer`);
  });

  it.each([" ", "\t", "\r", "\u00a0"])("rejects leading author whitespace %j without normalizing Git output", (whitespace) => {
    const head = rawCommit(`${whitespace}${bot}`, bot);
    publishObjects();
    const result = pushEvent(base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`Commit ${head}: disallowed author identity.\n`);
  });

  it.each([" ", "\t", "\r", "\u00a0"])("rejects trailing committer whitespace %j without normalizing Git output", (whitespace) => {
    const head = rawCommit(bot, `${bot}${whitespace}`);
    publishObjects();
    const result = pushEvent(base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`Commit ${head}: disallowed committer identity.\n`);
  });

  it.each([
    ["author", "", bot],
    ["committer", bot, ""],
  ])("rejects an empty %s identity", (field, author, committer) => {
    const head = rawCommit(author, committer);
    publishObjects();
    const result = pushEvent(base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`Commit ${head}: disallowed ${field} identity.\n`);
  });

  it("ignores optional signature display configuration for identity projection", () => {
    const head = rawCommit(bot, human, "gpgsig -----BEGIN SSH SIGNATURE-----\n Zml4dHVyZQ==\n -----END SSH SIGNATURE-----\n");
    publishObjects();
    git("config", "log.showSignature", "true");
    git("config", "gpg.ssh.allowedSignersFile", "/dev/null");
    git("config", "gpg.ssh.program", path.join(dir, "unavailable-verifier"));
    const trace = path.join(dir, "git-trace.json");
    env.GIT_TRACE2_EVENT = trace;
    const result = pushEvent(base, head);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("(1 commits inspected)");
    expect(result.stderr).toBe("");
    expect(readFileSync(trace, "utf8")).not.toContain("unavailable-verifier");
  });

  it("includes merge commit identities", () => {
    commit();
    git("checkout", "-b", "side", base);
    commit(human);
    git("checkout", "feature");
    execFileSync("git", ["-c", "commit.gpgsign=false", "merge", "--no-ff", "side", "-m", "merge fixture"], {
      cwd: repo, env: { ...env, GIT_AUTHOR_EMAIL: bad }, stdio: "pipe",
    });
    const head = git("rev-parse", "HEAD");
    publishObjects();
    expect(pushEvent(base, head).stderr).toContain(`${head}: disallowed author`);
  });

  it("accepts all three exact emails and historical humans without App trailers", () => {
    commit(human, "noreply@github.com");
    const head = commit();
    publishObjects();
    const result = pushEvent(base, head);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("(2 commits inspected)");
  });

  it("uses PR source/base OIDs rather than a synthetic checkout or current base tip", () => {
    const head = commit();
    git("checkout", "main");
    const synthetic = commit(bad);
    publishObjects();
    const event = { pull_request: { base: { ref: "main", sha: base }, head: { ref: "feature", sha: head } } };
    expect(runCI("pull_request", event, synthetic).stdout).toContain("(1 commits inspected)");
    event.pull_request.head.sha = synthetic;
    expect(runCI("pull_request", event, head).status).toBe(1);
  });

  it("manual dispatch includes lower unmerged stack layers, regardless of archive refs", () => {
    const older = commit(bad);
    git("branch", "archive", older);
    const head = commit();
    publishObjects();
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/archive");
    const result = runCI("workflow_dispatch", { repository: { default_branch: "main" } }, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(older);
  });

  it("manual dispatch on default explicitly checks its current commit", () => {
    const result = runCI("workflow_dispatch", { repository: { default_branch: "main" } }, base, "refs/heads/main");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("(1 commits inspected)");
    git("checkout", "main");
    const head = commit(bad);
    publishObjects();
    expect(runCI("workflow_dispatch", { repository: { default_branch: "main" } }, head, "refs/heads/main").status).toBe(1);
  });

  it("rejects missing or unverified manual default boundaries", () => {
    expect(runCI("workflow_dispatch", {}).status).toBe(1);
    expect(runCI("workflow_dispatch", { repository: { default_branch: "archive" } }).status).toBe(1);
    git("--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/missing");
    expect(runCI("workflow_dispatch", { repository: { default_branch: "main" } }).status).toBe(1);
  });

  it("checks complete initial push ancestry and handles deletion explicitly", () => {
    const head = commit();
    publishObjects();
    expect(pushEvent(zero, head).stdout).toContain("(2 commits inspected)");
    expect(pushEvent(head, zero).status).toBe(0);
    expect(pushEvent(zero, zero).status).toBe(1);
    const older = commit(bad);
    const latest = commit();
    publishObjects();
    expect(pushEvent(zero, latest).stderr).toContain(older);
  });

  it("accepts valid non-fast-forward boundaries but inspects newly introduced commits", () => {
    const old = commit();
    git("branch", "old", old);
    git("checkout", "-b", "replacement", base);
    const head = commit(human);
    publishObjects();
    expect(pushEvent(old, head).status).toBe(0);
    const invalid = commit(bad);
    publishObjects();
    expect(pushEvent(old, invalid).status).toBe(1);
  });

  it.each(["", "HEAD", "--all", "$(touch should-not-exist)", "f".repeat(40)])("fails closed for malformed/unavailable boundary %s", (boundary) => {
    const head = commit();
    publishObjects();
    const result = pushEvent(boundary, head);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("passed");
    expect(existsSync(path.join(repo, "should-not-exist"))).toBe(false);
    expect(pushEvent(base, boundary).status).toBe(1);
  });

  it("rejects missing PR boundaries, invalid refs, unsupported events and shallow history", () => {
    expect(runCI("pull_request", { pull_request: {} }).status).toBe(1);
    expect(runCI("push", { ref: "refs/heads/../bad", before: base, after: base }).status).toBe(1);
    expect(runCI("schedule", {}).status).toBe(1);
    writeFileSync(path.join(repo, ".git/shallow"), `${base}\n`);
    expect(pushEvent(zero, base).status).toBe(1);
  });

  it("pre-push checks new branches and existing unmerged history even when archived", () => {
    const older = commit(bad);
    git("branch", "archive", older);
    publishObjects();
    const head = commit();
    expect(prePush(update(head)).stderr).toContain(older);
    expect(prePush(update(head, older)).stderr).toContain(older);
  });

  it("pre-push checks every update, allows deletions/no updates, and rejects malformed/tag updates", () => {
    const valid = commit();
    publishObjects();
    const invalid = commit(bad);
    expect(prePush(update(valid, base, "one") + update(invalid, zero, "two")).status).toBe(1);
    expect(prePush(update(valid, base, "one") + update(valid, zero, "two")).status).toBe(0);
    expect(prePush(`(delete) ${zero} refs/heads/feature ${valid}\n`).status).toBe(0);
    expect(prePush("").status).toBe(0);
    expect(prePush("malformed\n").status).toBe(1);
    expect(prePush(update(valid).replaceAll("refs/heads/", "refs/tags/")).status).toBe(1);
    expect(prePush(update(valid, "f".repeat(40))).status).toBe(1);
  });

  it("pre-push covers default-branch and non-fast-forward updates", () => {
    const old = commit();
    publishObjects();
    git("checkout", "-b", "replacement", base);
    const head = commit(human);
    expect(prePush(update(head, old)).status).toBe(0);
    const invalid = commit(bad);
    expect(prePush(update(invalid, base, "main")).status).toBe(1);
  });

  it("fails closed on unrelated feature history and an unavailable destination", () => {
    git("checkout", "--orphan", "unrelated");
    const head = commit();
    expect(prePush(update(head)).status).toBe(1);
    rmSync(remote, { recursive: true, force: true });
    expect(prePush(update(head)).status).toBe(1);
  });

  it("wires the full-history real-source CI invocation without modifying other contexts", () => {
    const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    const job = workflow.split("  identity-guard:\n")[1].split("\n  ci:\n")[0];
    expect(job).toContain("ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}");
    expect(job).toContain("fetch-depth: 0");
    expect(job).toContain("run: node scripts/check-commit-identities.mjs ci");
    expect(job).not.toContain("--no-merges");
    expect(job).not.toContain("HEAD^");
    expect(hook.split("\n")[0]).toBe('node scripts/check-commit-identities.mjs pre-push "$2" || exit 1');
    expect(hook.split("\n")[1]).toBe("pnpm -r typecheck && pnpm -r --filter './packages/**' test && pnpm --filter @hta/db db:check && pnpm docs:check-drift");
  });

  it("the actual pre-push hook rejects before pnpm or publication, then permits a valid update", () => {
    const hooks = path.join(dir, "hooks");
    const bin = path.join(dir, "bin");
    mkdirSync(hooks);
    mkdirSync(bin);
    mkdirSync(path.join(repo, "scripts"));
    copyFileSync(checker, path.join(repo, "scripts/check-commit-identities.mjs"));
    writeFileSync(path.join(hooks, "pre-push"), `#!/bin/sh\n${hook}`);
    chmodSync(path.join(hooks, "pre-push"), 0o755);
    writeFileSync(path.join(bin, "pnpm"), '#!/bin/sh\nprintf "called\\n" >> "$QUALITY_MARKER"\n');
    chmodSync(path.join(bin, "pnpm"), 0o755);
    git("config", "core.hooksPath", hooks);
    const older = commit(bad);
    commit();
    const marker = path.join(dir, "quality");
    const push = () => spawnSync("git", ["push", "origin", "HEAD:refs/heads/proposed"], {
      cwd: repo, encoding: "utf8", env: { ...env, PATH: `${bin}:${env.PATH}`, QUALITY_MARKER: marker },
    });
    const rejected = push();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain(older);
    expect(existsSync(marker)).toBe(false);
    expect(git("ls-remote", "origin", "refs/heads/proposed")).toBe("");
    git("checkout", "-b", "valid", base);
    commit();
    expect(push().status).toBe(0);
    expect(readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(4);
    expect(git("ls-remote", "origin", "refs/heads/proposed")).toContain(git("rev-parse", "HEAD"));
  });
});
