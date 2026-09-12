import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdmin } from "@/lib/supabase/server";
import { projectDashboardSwim, swimDashboardObservationSchema } from "@/lib/swim/import-evidence";
import { hashSwimImportKey, swimImportBearer } from "@/lib/swim/import-key";
import { isMissingRpc } from "@/lib/supabase/rpc-errors";

export const runtime = "nodejs";
const MAX_BYTES = 1024 * 1024;
const receiptSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), replayed: z.boolean(),
}).strict();

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (process.env.SWIM_IMPORT_ENABLED !== "true") return failure("Swimming imports are not available.", 503);
  const key = swimImportBearer(request.headers.get("authorization"));
  if (!key) return failure("A swimming import key is required.", 401);
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return failure("Send a JSON swimming observation.", 415);
  }
  const size = request.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_BYTES)) {
    return failure("The swimming observation is too large.", 413);
  }
  if (!request.body) return failure("A swimming observation is required.", 400);
  const reader = request.body.getReader();
  const cancelRead = () => {
    void reader.cancel().catch(() => console.error("Swimming import request cleanup failed."));
  };
  const deadline = AbortSignal.timeout(10_000);
  let text: string;
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const abort = () => reject(new Error("request_timeout"));
        if (deadline.aborted) return abort();
        deadline.addEventListener("abort", abort, { once: true });
        reader.read().then(resolve, reject).finally(() => deadline.removeEventListener("abort", abort));
      });
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        cancelRead();
        return failure("The swimming observation is too large.", 413);
      }
      chunks.push(value);
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    cancelRead();
    return failure("The swimming observation could not be read.", deadline.aborted ? 408 : 400);
  } finally {
    reader.releaseLock();
  }
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return failure("The swimming observation is not valid JSON.", 400); }
  const parsed = swimDashboardObservationSchema.safeParse(raw);
  if (!parsed.success) return failure("The swimming observation has invalid or unsupported fields.", 422);
  const projected = projectDashboardSwim(parsed.data.activity, parsed.data.detail);
  if (!projected.ok) return failure("The swimming observation has invalid or unsupported fields.", 422);

  try {
    const client = createAdmin();
    const { data, error } = await client.rpc("swim_import_receive", {
      p_hash: hashSwimImportKey(key), p_evidence: projected.value,
    }).abortSignal(AbortSignal.timeout(10_000));
    if (error) {
      if (error.code === "42501") return failure("The swimming import key is invalid or disconnected.", 401);
      if (error.code === "22023" || error.code === "23514") return failure("The swimming observation is invalid.", 422);
      if (isMissingRpc(error)) return failure("Swimming imports are not available.", 503);
      console.error("Swimming import storage request failed.");
      return failure("The swimming observation could not be saved. Retry the same observation.", 503);
    }
    const receipt = receiptSchema.safeParse(data);
    if (!receipt.success) {
      console.error("Swimming import storage returned an invalid receipt.");
      return failure("The swimming receipt was incomplete. Retry the same observation.", 503);
    }
    return NextResponse.json(receipt.data, { status: receipt.data.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Swimming import storage request failed.");
    return failure("The swimming observation could not be saved. Retry the same observation.", 503);
  }
}
