/**
 * Eval-harness cassette I/O.
 *
 * Cassettes are sha256-keyed JSON files captured from a previous live
 * provider call. In replay mode (PR 1's only mode) the runner loads
 * a cassette and asserts the recorded response satisfies the fixture's
 * matchers. Refresh / strict modes ship in PR 2.
 *
 * Cassettes live under `apps/web/src/lib/ai/eval/cassettes/*.json`
 * and are checked into the repo. Same `promptHash` key as the
 * observability stack — production rows grow the corpus directly.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

export type CassetteRecord = {
  /** sha256 hex of (system + userPrompt + JSON.stringify(tools)). */
  promptHash: string;
  /** Recorded provider name; cassettes are provider-agnostic at read time. */
  provider: "anthropic" | "openai" | "gemini";
  /** Recorded response payload. Shape is up to the fixture. */
  response: unknown;
  /** Optional usage block. */
  usage?: { input_tokens: number; output_tokens: number; cache_hit?: boolean };
};

const DIR = path.resolve(__dirname, "cassettes");

function safeFilename(promptHash: string): string {
  // The hash is sha256 hex; sanitise defensively in case a caller
  // passes something else.
  return promptHash.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

export async function loadCassette(
  promptHash: string,
): Promise<CassetteRecord | null> {
  try {
    const file = path.join(DIR, safeFilename(promptHash));
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as CassetteRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveCassette(
  promptHash: string,
  record: CassetteRecord,
): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const file = path.join(DIR, safeFilename(promptHash));
  await fs.writeFile(file, JSON.stringify(record, null, 2) + "\n", "utf8");
}
