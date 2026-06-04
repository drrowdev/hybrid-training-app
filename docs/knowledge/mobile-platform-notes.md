# Mobile platform notes (PWA)

SxC ships as an installable PWA (no native wrapper). This documents what
the web platform gives us per-OS and the known limitations, so we don't
re-litigate them each cycle. We self-test primarily on iOS; the
experience must be equally good on Android.

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
- **Haptics do not fire on iOS.** `lib/feedback/hapticTick` uses the Web
  Vibration API (`navigator.vibrate`). iOS Safari has never implemented
  it — Apple does not expose the Taptic Engine to web pages — so the call
  silently no-ops on iPhone. The identical code produces a real buzz on
  Android. We keep the code (Android benefits); the audio beep covers the
  timer cue on iOS. Do NOT chase the unreliable `<label>`/switch hack.
- **Web push is limited.** iOS supports web push only when the app is
  installed to the home screen, 16.4+. We ship no push today.

## The native-wrapper lever (parked)
A Capacitor wrapper (Track B, parked 2026-06-04) would close both gaps:
its native **Haptics** plugin works on iPhone, and it gives full native
push (APNs on iOS, FCM on Android) with no home-screen-install caveat. It
was shelved because in-app **cardio capture** was dropped (cardio is
Strava's job), but haptics + push are independent reasons to revisit it.
Demand-gate: build it when users ask for reminders or iOS haptics, not
speculatively.

## Android parity checklist (because we self-test on iOS)
- Status-bar legibility: Android paints the bar with `theme_color`
  (`#a3e635`); confirm icons/text read well (iOS uses translucent).
- No double pull-to-refresh: custom PTR + `overscroll-behavior-y: contain`
  must suppress Chrome's native PTR.
- Maskable icon safe-zone: Android crops to squircle/circle — verify
  `icon-maskable-512` doesn't clip the glyph.
- Back gesture/hardware back navigates within the app from deep routes,
  doesn't unexpectedly exit the installed PWA.
