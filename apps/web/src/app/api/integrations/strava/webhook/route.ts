/**
 * Strava webhook HTTP route.
 *
 * GET — Strava's subscription handshake. Validates `hub.verify_token`
 * against `STRAVA_WEBHOOK_VERIFY_TOKEN` and echoes the challenge.
 *
 * POST — Receives push events. Always returns 200 (even on internal
 * error) so Strava stops retrying. Errors are persisted on the
 * strava_event_log row instead.
 *
 * Push events are NOT cryptographically signed by Strava — we rely on
 * (a) verify_token at subscription time and (b) per-event
 * subscription_id matching, both handled below + in the pure handler.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  handleStravaWebhookEvent,
  type StravaWebhookEvent,
} from "@/lib/integrations/strava/webhook-handler";
import { syncStravaSingle } from "@/lib/integrations/strava/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (mode !== "subscribe" || token !== expected || !challenge) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }
  return NextResponse.json({ "hub.challenge": challenge });
}

export async function POST(request: Request) {
  let body: StravaWebhookEvent;
  try {
    body = (await request.json()) as StravaWebhookEvent;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const subscriptionId = Number(env("STRAVA_WEBHOOK_SUBSCRIPTION_ID"));
  if (!Number.isFinite(subscriptionId)) {
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  // Service-role client — RLS is intentionally bypassed because this
  // path runs without a user session (Strava is the caller). Every
  // write below is scoped by user_id / athlete_id from the event.
  const supabase = createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const outcome = await handleStravaWebhookEvent(body, {
    supabase,
    env: { subscriptionId },
    syncSingle: syncStravaSingle,
  });

  if (outcome.kind === "error") {
    console.error("strava webhook error:", outcome.message);
  }
  return NextResponse.json({ ok: true });
}
