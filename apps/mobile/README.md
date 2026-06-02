# @hta/mobile — SxC iOS shell (Capacitor)

Native iOS wrapper for the SxC app, built for **solo on-device testing** at
**$0 out-of-pocket** via Capacitor → Codemagic (build) → SideStore (install).

> **Scope:** this stack is for testing on *your own* device. Sharing with other
> people, push notifications (APNs), and removing the 7-day reinstall cycle all
> require the **$99/yr Apple Developer Program** — deferred until you decide the
> app is worth sharing. See [Graduating](#graduating-to-shareable) below.

---

## Architecture: remote-load

The app is server-heavy (RSC, server actions, API routes, MCP, server-side
Supabase clients) and **cannot** be statically exported. So the shell does **not**
bundle a web build. Instead `capacitor.config.ts` sets:

```ts
server: { url: "https://getsxc.app" }
```

The native WKWebView loads the **live production site**, and Capacitor injects
its native bridge so in-page JS can call native plugins (GPS, BLE, …). Native
plugins work identically whether the page is bundled or remote-loaded.

**Consequences:**

- **Web changes ship via Vercel with NO rebuild.** You only rebuild the `.ipa`
  when native config or plugins change.
- `www/index.html` is just a charcoal **fallback shell** shown if `getsxc.app`
  is unreachable at launch.
- Offline resilience for *captured data* (GPS/HR) is the cardio tracker's job —
  it buffers locally and syncs when back online (Phase 4).

---

## 1. Build the unsigned `.ipa` (Codemagic)

CI config: [`/codemagic.yaml`](../../codemagic.yaml). It produces an **unsigned**
`.ipa` — no Apple credentials in CI, because SideStore signs on-device.

**One-time setup:**

1. Sign in at [codemagic.io](https://codemagic.io) with GitHub; authorize the
   `drrowdev/hybrid-training-app` repo.
2. Codemagic auto-detects `codemagic.yaml`. Pick the **`SxC iOS (unsigned, for
   SideStore)`** workflow.
3. No signing/env setup needed (unsigned build).

**Each build:**

- Start the workflow manually (Codemagic UI → *Start new build* → this workflow,
  or the API). It runs on a **Mac mini M2** (free tier: 500 min/month; a build
  is ~10–15 min).
- Download the **`SxC-unsigned.ipa`** artifact when it's green.

> Builds are manual on purpose to conserve free minutes. Because of remote-load,
> you rarely rebuild — only on native plugin/config changes.

---

## 2. Install via SideStore (free Apple ID, untethered auto-refresh)

[SideStore](https://sidestore.io) resigns the `.ipa` with your **free Apple ID**
dev certificate and installs it over an on-device VPN — then **auto-refreshes**
the 7-day certificate in the background, no PC babysitting required.

**One-time setup:**

1. **Anisette server** (Apple auth):
   - Easiest: run one locally with Docker —
     `docker run -d -p 6969:6969 dadoum/anisette-v3-server`, or
   - Always-on/standalone: host the same container on an **Oracle Cloud Always
     Free** ARM VM so refreshes work even when your PC is off.
2. **Pair the device** (needs a PC once): generate a pairing file per the
   [SideStore setup guide](https://docs.sidestore.io) and install the SideStore
   app on the iPhone.
3. In SideStore → **Settings**, point it at your anisette server URL and sign in
   with your Apple ID.

**Install the app:**

1. Transfer `SxC-unsigned.ipa` to the iPhone (AirDrop, Files, a download link).
2. SideStore → **My Apps → +** → pick the `.ipa` → install.
3. Trust the developer cert if prompted (Settings → General → VPN & Device
   Management).

**Keep it alive:**

- SideStore refreshes automatically while it can reach the anisette server +
  network. If a refresh is ever missed, open SideStore and tap **Refresh** (~10s).
- **Don't stay offline / away from the refresh path for >7 days** or the cert
  lapses and the app won't launch until you refresh.

---

## 3. Local dev (optional, needs a Mac)

Windows can scaffold and commit the iOS project (as done here), but running it in
a simulator/Xcode needs macOS:

```bash
pnpm --filter @hta/mobile exec cap sync ios
pnpm --filter @hta/mobile exec cap open ios   # opens Xcode
```

Regenerate branding after a wordmark change:

```bash
node apps/mobile/scripts/generate-app-icon.mjs
node apps/mobile/scripts/generate-splash.mjs
```

---

## Graduating to shareable

When you want to hand the app to training partners or ship features that need
native push:

| Need | Unlocks |
| --- | --- |
| **$99/yr Apple Developer Program** | 1-year signing (no 7-day cycle), **APNs push**, **TestFlight**, unlimited installs |
| EU **AltStore PAL** / Web Distribution | Install without 7-day expiry for EU users (still needs the paid program) |

At that point, revisit whether to keep remote-load or invest in a static-client +
API split for true App Store distribution and offline-first. That decision is
driven by **distribution needs**, not by Capacitor itself.
