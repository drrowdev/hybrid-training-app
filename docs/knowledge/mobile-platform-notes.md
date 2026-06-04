# Mobile platform notes (PWA + Capacitor shell)

SxC ships as an installable PWA, optionally wrapped in a thin Capacitor
native shell (`apps/mobile/`, remote-load of getsxc.app) that adds native
Taptic-Engine haptics. This documents what each layer gives us per-OS and
the known limitations, so we don't re-litigate them each cycle. We
self-test primarily on iOS; the experience must be equally good on Android.

## What works on both iOS and Android
- **Install to home screen** — `manifest.webmanifest` (maskable icons,
  app shortcuts, `display: standalone`, portrait lock), Apple touch icon
  + per-device splash screens, light/dark `theme-color`.
- **Offline shell** — service worker (`public/sw.js`): network-first for
  `/app/*` with a 3s timeout → `offline.html`; stale-while-revalidate for
  Next chunks, icons, and movement-search.
- **Safe-area insets** — `env(safe-area-inset-*)` on TopNav, BottomTabBar,
  AppShell, RestTimer, ChatFab, UndoBanner (`viewport-fit: cover`).
- **Screen wake lock** — `lib/pwa/wake-lock.ts` + `SessionWakeLock`
  component keep the screen awake while a session is in progress
  (`!isComplete`). W3C Screen Wake Lock API; re-acquires on
  `visibilitychange` → visible because the OS auto-releases when hidden.
  Supported iOS 16.4+ Safari and Android Chrome; best-effort no-op below.
- **Audio timer beep** — Web Audio (`lib/feedback/timerBeep`). Covers the
  "rest timer done" cue on every platform, including iOS.

## Known iOS-only limitations
- **Web push is limited.** iOS supports web push only when the app is
  installed to the home screen, 16.4+. Full native push (APNs) needs the
  Capacitor shell *and* the $99/yr Apple Developer Program — see below.

## Native haptics (Capacitor shell)
`lib/feedback/hapticTick` prefers the native **Taptic Engine** when running
inside the Capacitor shell: it calls the `@capacitor/haptics` plugin over the
injected `window.Capacitor` bridge (mapping the legacy vibration duration onto
an impact weight — LIGHT/MEDIUM/HEAVY). This is the ONLY way to get a real buzz
on iPhone, since iOS Safari never implemented the Web Vibration API. On plain
web (no bridge) it falls back to `navigator.vibrate` — a real buzz on Android,
a silent no-op on iOS browsers. One codebase, progressive enhancement. The web
bundle imports no native deps; the plugin is declared in `apps/mobile` and
discovered by `cap sync`. Do NOT chase the unreliable `<label>`/switch hack.

## The native-wrapper lever
The Capacitor shell lives at `apps/mobile/` (remote-load of `getsxc.app`). Its
native **Haptics** plugin closes the iOS haptics gap (shipped). Native **push**
(APNs iOS / FCM Android) is still gated on the **$99/yr Apple Developer
Program** — a free-Apple-ID / SideStore build cannot carry the `aps-environment`
entitlement — plus a backend send pipeline (device-token table + a trigger).
Demand-gate push: build it when users ask for reminders, not speculatively.

## Android parity checklist (because we self-test on iOS)
- Status-bar legibility: Android paints the bar with `theme_color`
  (`#a3e635`); confirm icons/text read well (iOS uses translucent).
- No double pull-to-refresh: custom PTR + `overscroll-behavior-y: contain`
  must suppress Chrome's native PTR.
- Maskable icon safe-zone: Android crops to squircle/circle — verify
  `icon-maskable-512` doesn't clip the glyph.
- Back gesture/hardware back navigates within the app from deep routes,
  doesn't unexpectedly exit the installed PWA.
