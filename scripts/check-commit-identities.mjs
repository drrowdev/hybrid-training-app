import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowed = new Set([
  "223556219+Copilot@users.noreply.github.com",
  "280348738+drrowdev@users.noreply.github.com",
  "noreply@github.com",
]);
const zero = "0".repeat(40);
const commits = new Set();

function fail(message) {
  throw new Error(message);
}

function git(...args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
    }).replace(/\n$/, "");
  } catch {
    fail("Git operation failed; identity coverage cannot be established.");
  }
}

function oid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    fail("Invalid commit boundary.");
  }
  return value;
}

function branch(value) {
  if (typeof value !== "string" || !value.startsWith("refs/heads/")) {
    fail("Expected a branch ref.");
  }
  git("check-ref-format", value);
  return value;
}

function branchName(value) {
  if (typeof value !== "string" || !value) fail("Missing branch name.");
  return branch(`refs/heads/${value}`);
}

function commit(value) {
  oid(value);
  if (value === zero || git("cat-file", "-t", value) !== "commit") {
    fail("Unavailable commit boundary.");
  }
  return value;
}

function fetchCommit(remote, value) {
  oid(value);
  if (value === zero) fail("Missing commit boundary.");
  git("fetch", "--no-tags", "--no-write-fetch-head", "--", remote, value);
  return commit(value);
}

function addRange(head, base) {
  commit(head);
  if (base) commit(base);
  const result = git("rev-list", head, ...(base ? [`^${base}`] : []), "--");
  for (const sha of result.split("\n").filter(Boolean)) commits.add(oid(sha));
}

function defaultBoundary(remote, expected) {
  // Query the destination, not a stale local origin/HEAD or an archive ref.
  const lines = git("ls-remote", "--symref", "--", remote, "HEAD").split("\n");
  const ref = lines.find((line) => line.startsWith("ref: "))?.split("\t")[0].slice(5);
  branch(ref);
  if (expected !== undefined && ref !== branchName(expected)) {
    fail("Default branch does not match repository metadata.");
  }
  const sha = lines.find((line) => /^[0-9a-f]{40}\tHEAD$/.test(line))?.split("\t")[0];
  return { ref, sha: fetchCommit(remote, sha) };
}

function addFeature(head, base) {
  // Unrelated histories cannot establish a trusted default-branch boundary.
  git("merge-base", commit(head), commit(base));
  addRange(head, base);
}

function ci() {
  let event;
  try {
    event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    fail("Cannot read CI event metadata.");
  }
  switch (process.env.GITHUB_EVENT_NAME) {
    case "pull_request": {
      const pr = event.pull_request;
      branchName(pr?.base?.ref);
      branchName(pr?.head?.ref);
      const base = fetchCommit("origin", pr?.base?.sha);
      const head = fetchCommit("origin", pr?.head?.sha);
      addRange(head, base);
      break;
    }
    case "push": {
      branch(event.ref);
      const before = oid(event.before);
      const after = oid(event.after);
      if (before === zero && after === zero) fail("Empty push boundaries.");
      if (before !== zero) fetchCommit("origin", before);
      if (after !== zero) {
        fetchCommit("origin", after);
        addRange(after, before === zero ? undefined : before);
      }
      break;
    }
    case "workflow_dispatch": {
      const ref = branch(process.env.GITHUB_REF);
      const head = commit(process.env.GITHUB_SHA);
      if (typeof event.repository?.default_branch !== "string") {
        fail("Missing repository default branch.");
      }
      const base = defaultBoundary("origin", event.repository.default_branch);
      if (ref === base.ref) commits.add(head);
      else addFeature(head, base.sha);
      break;
    }
    default:
      fail("Unsupported CI event.");
  }
}

function prePush(remote) {
  if (typeof remote !== "string" || !remote || /^[\-]/.test(remote) || /[\x00-\x20\x7f]/.test(remote)) {
    fail("Invalid push destination.");
  }
  const input = readFileSync(0, "utf8").trim();
  if (!input) return;
  const updates = input.split("\n").map((line) => {
    const fields = line.split(/\s+/);
    if (fields.length !== 4) fail("Malformed pre-push update.");
    const [localRef, localOid, remoteRef, remoteOid] = fields;
    branch(remoteRef);
    oid(localOid);
    oid(remoteOid);
    if (localOid === zero) {
      if (localRef !== "(delete)" || remoteOid === zero) fail("Invalid deletion.");
    } else {
      if (localRef !== "HEAD" && !/^[0-9a-f]{40}$/.test(localRef)) branch(localRef);
      commit(localOid);
    }
    if (remoteOid !== zero) fetchCommit(remote, remoteOid);
    return { localOid, remoteOid, remoteRef };
  });
  const live = updates.filter((update) => update.localOid !== zero);
  if (!live.length) return;
  const base = defaultBoundary(remote);
  for (const { localOid, remoteOid, remoteRef } of live) {
    if (remoteRef !== base.ref) addFeature(localOid, base.sha);
    // Also cover commits introduced by rewinds/non-fast-forward updates.
    addRange(localOid, remoteOid === zero ? (remoteRef === base.ref ? undefined : base.sha) : remoteOid);
    if (localOid === base.sha) commits.add(localOid);
  }
}

try {
  if (git("rev-parse", "--is-shallow-repository") !== "false") {
    fail("Full history is required for identity checking.");
  }
  if (process.argv[2] === "ci" && process.argv.length === 3) ci();
  else if (process.argv[2] === "pre-push" && process.argv.length === 4) prePush(process.argv[3]);
  else fail("Expected ci or pre-push <destination>.");

  let bad = false;
  for (const sha of commits) {
    const identities = git("show", "--no-show-signature", "-s", "--format=%ae%n%ce", sha, "--").split("\n");
    if (identities.length !== 2) fail(`Commit ${sha}: malformed identity fields.`);
    for (const [index, field] of ["author", "committer"].entries()) {
      if (!allowed.has(identities[index])) {
        console.error(`Commit ${sha}: disallowed ${field} identity.`);
        bad = true;
      }
    }
  }
  if (bad) process.exitCode = 1;
  else console.log(`Identity check passed (${commits.size} commits inspected).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Identity check failed.");
  process.exitCode = 1;
}
