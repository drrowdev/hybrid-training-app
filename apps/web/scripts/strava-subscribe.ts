#!/usr/bin/env tsx
/**
 * One-time Strava push-subscription registration.
 *
 * Run once per environment (dev / prod) AFTER deploying the webhook
 * route. Strava replies with a subscription id — paste it into the
 * STRAVA_WEBHOOK_SUBSCRIPTION_ID env var.
 *
 * Required env:
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *   STRAVA_WEBHOOK_CALLBACK_URL    e.g. https://app.example.com/api/integrations/strava/webhook
 *   STRAVA_WEBHOOK_VERIFY_TOKEN    any opaque string; must match the env on the receiving end
 */
export {};

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const clientId = need("STRAVA_CLIENT_ID");
  const clientSecret = need("STRAVA_CLIENT_SECRET");
  const callbackUrl = need("STRAVA_WEBHOOK_CALLBACK_URL");
  const verifyToken = need("STRAVA_WEBHOOK_VERIFY_TOKEN");

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    callback_url: callbackUrl,
    verify_token: verifyToken,
  });

  const res = await fetch("https://www.strava.com/api/v3/push_subscriptions", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
