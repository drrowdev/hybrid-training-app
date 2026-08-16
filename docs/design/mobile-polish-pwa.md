# Feature design: Mobile polish + PWA install

**Status:** Partially built. The in-session ergonomics half shipped 2026-08-16 (see
"Build status" below); the PWA half is still queued.
**Last updated:** 2026-08-16

---

## Build status (2026-08-16)

The in-session pieces of §5 are **built**, though not exactly as sketched here.
What actually shipped, and why it differs:

| Spec'd here | Shipped | Note |
| --- | --- | --- |
| "Sticky bottom action bar (`Next set` / `Complete`)" | `SessionDock` — primary CTA + rest countdown + movement navigator | Measured first: the CTA was **below the fold in all three sections at 375×667**, so this was the single highest-impact fix. The dock is one owner of the bottom region; previously the rest timer and the action row were independently `position: fixed`. |
| "Increment buttons flank the weight input as ≥44pt buttons" | Already existed; the **number field itself** was 31–40px wide | Fixed by tightening the stepper's internal padding. |
| "Touch-target audit: every interactive element ≥ 44pt" | Enforced and now **test-guarded** | Dot pips, the how-to badge and the skip links were all under the floor. A Playwright assertion fails the build if any control regresses. |
| "One-handed reach: primary actions on the bottom 40%" | Achieved via the dock | Chrome above the movement name went from 294–375px to **133px**. |
| — (not spec'd) | **Movement navigator sheet** | Section navigation used to render only when the day contained rehab, and the movement queue clipped 3 of 5 movements off-screen. Neither problem was anticipated by this document. |

Still open from §5: nothing for the session page. Still open overall: the entire
PWA section (§6) and the Plan / Today / Settings responsive tweaks.

---

## 1. Why

The app is currently web-default — fine on desktop, friction-prone on a phone in a gym. Real usage is one-handed, sweaty thumbs, sometimes between sets without focus. This pass shrinks per-set logging friction and adds **home-screen install** so the app feels like a native log book.

## 2. Scope contract

**In v1 (this build):**
- Touch-target audit: every interactive element ≥ 44pt height (Apple HIG / Material spec)
- Sticky bottom action bar on the in-session log page ("Next set" / "Complete session")
- Weight + reps inputs: large native steppers with sensible increments (2.5 kg / 1 lb / 1 rep)
- One-handed reach: primary actions on the bottom 40% of the screen
- PWA manifest + service worker for "Add to Home Screen" on iOS/Android
- Offline reads (cached planned sessions + movement catalog) — last-known plan still loads on a flaky gym connection
- Install nudge banner (dismissible, shows once)

**Out of v1:**
- Native iOS/Android app (Capacitor wrapper — backlog)
- Offline writes / background sync (Phase 2)
- Push notifications (Phase 2)
- Apple Watch / Garmin integration (HRV backlog)

## 3. Constraints already encoded

None of the design-constraints touch UI density directly, but plan §3.5 says **gym-floor-first**: every primary action reachable one-handed, no tiny tap targets, no modal-on-modal stacks.

## 4. Data model

No schema changes. PWA is pure client.

## 5. UX changes

### Per-session log page (`/app/sessions/[id]`)
- Sticky bottom bar:
  - Left: "Next set →" (advances the set cursor without leaving the page)
  - Right: "Complete" (wraps the session)
- Set rows: tap to expand inline, weight + reps + RPE in one row at thumb height
- Increment buttons (`-2.5` / `+2.5` kg) flank the weight input as ≥44pt buttons
- Reps stepper: `-1` / `+1` same treatment

### Plan + Today pages
- Cards full-width on phone, no horizontal scroll
- "Start session" CTA always visible above the fold

### Settings + Stats
- Long forms wrap to single-column on phone; field labels stack above inputs

## 6. PWA setup

- `public/manifest.webmanifest`:
  - name, short_name "Hybrid"
  - icons (192/256/384/512 PNG) — generate from the existing accent-on-dark palette
  - `display: "standalone"`, `theme_color: "#a3e635"`, `background_color: "#0a0a0a"`
  - `start_url: "/app"`
- `next-pwa` or hand-rolled service worker:
  - Cache: app shell, /app routes, /api/movements/search, /api/me/export
  - Strategy: network-first for `/app/*`, cache-first for assets, stale-while-revalidate for the movement catalog
- Install prompt banner:
  - Hooks `beforeinstallprompt`
  - Shows a small bottom-card "Install Hybrid for faster gym access" on third visit
  - Dismiss persists in `localStorage`

## 7. Build sequence

1. Touch-target audit pass on existing components (low risk, mechanical)
2. Sticky bottom action bar on session log page
3. Weight / reps stepper input component (reusable)
4. Plan / Today / Settings responsive tweaks (mobile-first CSS)
5. PWA manifest + icons
6. Service worker registration + cache strategies
7. Install prompt banner component
8. Lighthouse audit pass — target PWA score ≥ 90, mobile Performance ≥ 85
9. Manual real-device test on iOS Safari + Android Chrome

## 8. Open questions for kickoff

- **Icon set:** lime accent on charcoal? Or a simpler glyph? Recommend reusing the favicon design at higher resolutions.
- **Sticky bar opacity:** solid or translucent-with-blur? Translucent looks better but cuts into the set list when scrolled. Recommend solid + a small drop shadow.
- **Offline writes:** explicitly out of v1 — but should the UI gracefully degrade ("you're offline, this set will sync when you reconnect") or just disable submit? Recommend disable + a "back online — your set has been saved" toast for v1; full offline writes is Phase 2.
- **iOS install prompt:** iOS doesn't fire `beforeinstallprompt`. Show a manual "Add to Home Screen" instruction card on iOS only? Recommend yes — single dismissible card with the Safari share-icon-then-"Add to Home Screen" steps.
