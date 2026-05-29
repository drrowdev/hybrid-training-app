#!/usr/bin/env tsx
/**
 * List the current Strava push-subscriptions for this app. Useful when
 * verifying STRAVA_WEBHOOK_SUBSCRIPTION_ID matches reality, or when
 * cleaning up stale subscriptions before re-registering.
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
  const url = new URL("https://www.strava.com/api/v3/push_subscriptions");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  const res = await fetch(url.toString());
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
