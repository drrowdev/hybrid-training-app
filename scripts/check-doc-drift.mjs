#!/usr/bin/env node
/**
 * Knowledge-doc drift guard.
 *
 * Two canonical engine docs are maintained in TWO places:
 *   - in-repo:    docs/knowledge/<name>.md           (committed, public)
 *   - workspace:  $HTA_WORKSPACE_DOCS/<name>.md       (the author's private
 *                 canonical mirror — NOT in the repo)
 * The two copies are intentionally NOT byte-identical: their prose/cells are
 * worded independently. What must stay in lockstep is their *structural
 * coverage* — every ADR / CP-2 row present in one copy must exist in the other.
 * The recurring failure mode is shipping an engine ADR and updating only one
 * copy (or neither), so the table silently lags the code.
 *
 * Modes (mirrors the migration drift guard's offline/full split):
 *
 *   FULL  — when HTA_WORKSPACE_DOCS points at an existing dir (developer
 *           machines / pre-push). Asserts repo↔workspace coverage parity for
 *           every mirrored doc.
 *   OFFLINE — when the workspace dir is absent (CI / GitHub runners, which
 *           cannot see the private mirror). Runs the self-contained in-repo
 *           checks only: (a) every Accepted ADR that declares it adds a CP-2
 *           row is actually referenced in the CP-2 doc, and (b) CP-2 row
 *           numbers are contiguous + unique.
 *
 * The workspace path is read ONLY from $HTA_WORKSPACE_DOCS — never hardcoded —
 * so no private local path lands in the committed (public) repo.
 *
 * Exit 0 = clean (or offline-skipped cross-location part). Exit 1 = drift.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const knowledgeDir = join(repoRoot, "docs", "knowledge");
const adrDir = join(repoRoot, "docs", "adr");

/** Docs that exist in both the repo and the private workspace mirror. */
const MIRRORED_DOCS = [
  "hybrid-training-design-constraints.md",
  "hybrid-training-engine-live.md",
];

const CP2_DOC = "hybrid-training-design-constraints.md";

const errors = [];
const notices = [];

/** All "ADR 0007"-style references in a blob, normalised to 4-digit ids. */
function adrRefs(text) {
  const set = new Set();
  for (const m of text.matchAll(/\bADR[\s-]*(\d{3,4})\b/gi)) {
    set.add(m[1].padStart(4, "0"));
  }
  return set;
}

function read(path) {
  return readFileSync(path, "utf8");
}

// ─── In-repo checks (always run) ───────────────────────────────────

const cp2RepoPath = join(knowledgeDir, CP2_DOC);
const cp2RepoText = read(cp2RepoPath);

// Every Accepted ADR that says it adds a CP-2 row must be referenced
// in the CP-2 doc by number. (Row numbering itself is intentionally not
// asserted: the constants table has long-standing manual numbering quirks
// and the doc contains other, unrelated numbered tables.)
const cp2Refs = adrRefs(cp2RepoText);
const ADDS_ROW =
  /CP-2 table gains a row|CP-2 rows?\b|add (?:a |)CP-2 rows?|rows? (?:in|to) the CP-2 table|new (?:CP-2 |)row .{0,30}CP-2/i;
const NEGATES_ROW = /no (?:new |)CP-2|CP-2 numeric (?:change|constants?)[^.]*\bunchanged\b|No new CP-2/i;

for (const file of readdirSync(adrDir)) {
  const m = file.match(/^(\d{4})-.*\.md$/);
  if (!m) continue;
  const id = m[1];
  const text = read(join(adrDir, file));
  const accepted = /^\*\*Status:\*\*\s*Accepted/im.test(text);
  if (!accepted) continue;
  if (!ADDS_ROW.test(text)) continue;
  if (NEGATES_ROW.test(text)) continue;
  if (!cp2Refs.has(id)) {
    errors.push(
      `ADR ${id} (${file}) is Accepted and declares it adds a CP-2 row, ` +
        `but '${CP2_DOC}' has no reference to ADR ${id}. ` +
        `Add the CP-2 row (repo + workspace mirror).`,
    );
  }
}

// ─── Cross-location parity (FULL mode only) ────────────────────────

const wsDir = process.env.HTA_WORKSPACE_DOCS;
const haveWorkspace = wsDir && existsSync(wsDir) && statSync(wsDir).isDirectory();

if (!haveWorkspace) {
  notices.push(
    wsDir
      ? `HTA_WORKSPACE_DOCS='${wsDir}' does not exist — skipping repo↔workspace parity (offline mode).`
      : "HTA_WORKSPACE_DOCS not set — skipping repo↔workspace parity (offline mode). " +
          "Set it to the private mirror dir to enable the full check.",
  );
} else {
  for (const doc of MIRRORED_DOCS) {
    const repoPath = join(knowledgeDir, doc);
    const wsPath = join(wsDir, doc);
    if (!existsSync(wsPath)) {
      errors.push(`Workspace mirror missing: '${wsPath}' (repo has '${doc}').`);
      continue;
    }
    const repoText = read(repoPath);
    const wsText = read(wsPath);

    // ADR coverage parity.
    const repoAdr = adrRefs(repoText);
    const wsAdr = adrRefs(wsText);
    const missingInWs = [...repoAdr].filter((id) => !wsAdr.has(id)).sort();
    const missingInRepo = [...wsAdr].filter((id) => !repoAdr.has(id)).sort();
    if (missingInWs.length)
      errors.push(
        `${doc}: ADR ${missingInWs.join(", ")} present in repo but NOT in workspace mirror.`,
      );
    if (missingInRepo.length)
      errors.push(
        `${doc}: ADR ${missingInRepo.join(", ")} present in workspace mirror but NOT in repo.`,
      );
  }
}

// ─── Report ────────────────────────────────────────────────────────

for (const n of notices) console.log(`note: ${n}`);

if (errors.length) {
  console.error("\n✗ Knowledge-doc drift detected:\n");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nFix the doc(s) above. CP-2 / engine-live changes must land in BOTH the " +
      "repo (docs/knowledge/) and the private workspace mirror.\n",
  );
  process.exit(1);
}

console.log(
  `✓ Knowledge-doc drift guard passed${haveWorkspace ? " (full: repo↔workspace parity)" : " (offline: in-repo checks only)"}.`,
);
