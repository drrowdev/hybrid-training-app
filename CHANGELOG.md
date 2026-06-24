# Changelog

All notable changes to this project will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
### Native-feel pass — Phase 1f: PR celebration
- Setting a personal record now *feels* like one. When a logged set beats your saved
  1RM (a Weight or e1RM PR), the existing PR badges now land with a quick celebratory
  **pop** animation (`cp-pop`, reduced-motion aware) and fire a heavier, distinct
  **haptic** — separate from the normal light log tick. The e1RM-only readout (no PR)
  also drops monospace for the body sans.

### Native-feel pass — Phase 1e: per-movement completion ring
- Each movement card's status pill (the monospace `2/4` / `2/4 ✓` chip) becomes a small
  **circular progress ring** that fills as you log the movement's sets — muted while not
  started, accent while in progress, and a success ring with a ✓ when complete. A
  glanceable, native-fitness-app way to see how far through a lift you are.

### Native-feel pass — Phase 1d: rest timer as a circular-countdown sheet
- The rest timer is no longer an edge-to-edge slim bar with a monospace mm:ss and a
  linear progress strip. It's now a **floating, rounded bottom sheet** (inset from the
  screen edges, docked above the nav, safe-area aware) that **slides up** when it
  appears (`cp-sheet-up`, reduced-motion aware), with a **circular countdown ring**
  around a bold sans mm:ss, a clear “Rest · next <movement>” context, and larger
  44px ±30s controls. Tapping the ring still dismisses the rest; the zero-buzz +
  chirp are unchanged.

### Native-feel pass — Phase 1c: card-tap haptic + no accidental text selection
- Expanding/collapsing a movement card now fires a light haptic tick (honoring the
  user's haptics preference), adding tactile feedback to the most-used logging gesture.
- Interactive chrome (`.cp-btn` buttons, card-header toggles, tab links, the reorder
  grip — all `role="button"`) is now `user-select: none`, so a long-press no longer
  selects UI text the way a web page does. Body/content text stays selectable.

### Native-feel pass — Phase 1b: logging screen typography + card reveal
- Continues the native-feel work on the workout logger. Section headers (“Main lifts”,
  “Accessory work”) go from a centered uppercase monospace divider to a clean
  left-aligned **bold sans** heading; the collapsed movement-card summary (e.g.
  `4 × 6 @ 72% 1RM`) and the TM/1RM badge drop monospace for the body sans. Expanding a
  movement card now plays a quick fade + slide **reveal** (`cp-reveal`, reduced-motion
  aware) so opening a lift feels like a native disclosure instead of an instant pop. No
  logic changes.

### Native-feel pass — Phase 1a: Today screen typography (UX review)
- First slice of the "make it feel native, not web" work. Softened the Today screen
  away from the tactical/terminal look toward a warm consumer-app feel, with no logic
  changes: the page heading drops the uppercase stencil for a clean bold sans; the
  eyebrow and hero pills (top-set, movement count, est. minutes) drop the monospace for
  the body sans; and the shared "This week" rail gets a sentence-case section title,
  sans day/kind/chip labels (was monospace), bolder workout names, and a touch more row
  breathing room. The dominant "Start workout" CTA is unchanged. Further increments
  (logging cards + expand animation, rest-timer sheet, pervasive haptics) follow.

### Logging UI polish — aligned accessory cards + hidden AI FAB
- **Accessory cards now align with the main-lift cards.** The drag-to-reorder grip
  used to sit in an external column that shrank each accessory card and left the cards
  visually misaligned. The grip is now a subtle handle *inside* the card header (after
  the disclosure arrow), so every card is full-width and edge-aligned. Drag-to-reorder
  is unchanged (pointer-driven, touch + mouse).
- **The AI chat FAB no longer covers the logging screen.** It's hidden on the
  full-screen session surfaces (logging, start flow, cardio capture) where it overlapped
  the movement cards. Chat is still reachable there via the in-context "Ask why"
  affordance; the FAB stays on the rest of the app.

### Logging-experience fixes (bug batch)
- **Strava autofill banner no longer shows on pure-strength workouts.** The
  "STRAVA — no match yet / Sync now" banner is gated on the session actually having a
  cardio component (`hasCardio`), so a strength-only day (e.g. a HYROX lifting day)
  doesn't surface a Strava matcher that can't apply.
- **Accessories now log every prescribed set.** Platform programs (HYROX, 5/3/1, …)
  stored each accessory as one `sets: N` item, so the set logger offered a single
  loggable set ("1 × 6") even though the plan/preview/drawer showed "3 × 6". Accessory
  sets are now expanded one-item-per-set in the platform adapter (the canonical shape
  mains already use), so the logger renders one slot per set and matches the preview;
  the plan card, drawer, and preview collapse them back to "N × reps" for display.
- **Plan drawer close (×) is reachable on mobile.** The full-screen drawer's sticky
  header now keeps its close button below the status bar / notch via
  `env(safe-area-inset-top)`.
- **Reverse Crunch has how-to instructions.** Added a `movement_instructions` entry so
  its in-session info sheet renders (summary / setup / steps / cues).

### HYROX no-race × Season planner — peak blocks still taper to the event (ADR 0060)
- Follow-up to the no-race split: a HYROX block deployed for a **season peak slot**
  must still taper to its event, but with the race/no-race split a blank race date now
  means "no taper". The program wizard, when opened for a season block whose emphasis
  is peaking (`peak`/`realize`) and whose season targets an event date, now **pre-fills
  the race date** from that event — so the peak block tapers as intended (the user can
  still clear it). Non-peak season slots stay raceless = ongoing maintenance, which
  removes a spurious mid-season end-taper the old behaviour produced. The Season
  descriptor's `arcRoles` already spanned both modes; only its comment was updated
  (adding "maintenance" would be wrong — raceless HYROX is full-volume, not recovery).

### HYROX without a race — no-taper concurrent-maintenance mode (ADR 0060)
- A HYROX block with **no race date** used to still taper toward an *implied* race on
  the block's end date (the wizard even promised a "fixed end-taper"), ending on a
  0-strength race-pace primer for a race that doesn't exist. Periodization theory
  (Fitzgerald) and annual-plan practice (Friel) agree this spends a transient peak you
  won't use; the right shape is a concurrent **maintenance** state, not a phantom peak
  and not endless pure base.
- HYROX is now **binary**: with a race date it peaks as before (Base/Build/Specific/
  Taper to race week); **without** one it runs a short capped Base intro
  (`NO_RACE_BASE_WEEKS`, ~4 wk — not the proportional race-mode base, so a re-created
  block doesn't keep re-basing a maintained athlete) then a **held Build steady state**:
  the ADR 0059 two-strength alternation + station + quality + compromised every week,
  every-4th-week deloads for undulation, **no Specific, no sims, no taper**. The Build
  load is steady (fixed scheme + alternating—not escalating—quality), avoiding the
  burnout Friel warns about with no near-term start line. Adding a race date later lays
  Specific + Taper onto the tail to peak from the maintained base. `[DEF]` scheduling
  default — no new CP-2 constant. (Season-planner arc-role reconciliation for a raceless
  HYROX block is a tracked follow-up.)

### HYROX Build — alternate a second strength day at 5 sessions/week (ADR 0059)
- A 12-week / 5-day HYROX block used to drop from two strength days (Base) to **one**
  for the entire Build *and* Specific block — eight straight weeks of single-day
  maintenance, an abrupt `2 → 1` cliff. The Build phase now **alternates** at a
  5-session budget: every other Build week swaps the (bankable) long run for a second
  split strength day (`strength-a` / `strength-b`), so strength tapers
  `2 → ~1.5 → 1 → race` instead. The high-specificity endurance — station, quality
  run, compromised run — stays **weekly**; only the long run alternates. Front-loaded
  (the first non-deload Build week is a double) so a fresh post-deload block
  re-accumulates strength first. Build-only, 5-sessions-only: 3–4/wk and 6+/wk are
  unchanged (6+ already carries two strength days). `[DEF]` scheduling default — no
  new CP-2 constant.

### HR zones — instant re-bucketing + region-ledger recompute on edit (#559, #560)
- New `cardio_logs.hr_histogram` jsonb (migration 0109): a compact, band-independent
  `bpm → seconds` distribution captured from the per-second HR stream at import. It
  lets a zone-config change re-bucket every past activity's `hr_zones` **locally**
  (via `zonesFromHistogram`) with **no Strava re-fetch** — closing the gap where
  editing your HR zones left historical time-in-zone stale.
- Saving HR zones (`updateHrZones`) now (a) re-buckets all stored activities from
  their histograms against the new bands and (b) refreshes the cached `region_state`
  ledger (cardio's contribution is time-in-zone weighted), so the freshness/
  interference math reflects the new zones. Best-effort; ESL is untouched (it reads
  `inferred_kind` + duration, not `hr_zones`). New `hr-histogram.ts`.

### Strava history import — measured time-in-zone (#558)
- Historical import now fetches the per-second HR stream per activity (the same path
  the webhook sync already used) and buckets **true** time-in-zone instead of the
  summary leak-model approximation, which dumped most of an activity's time into the
  single band containing its average HR. Best-effort: one streams call per activity
  when zone bands exist; a null result (no stream / 404 / rate-limit) falls back to
  the approximation, so large imports degrade gracefully. Extends ADR 0009 (which
  originally left bulk/history paths summary-only).

### Activity-aware post-session summary card (#557, #564)
- The "Workout complete!" card now reflects what was actually done. Pure-cardio
  sessions (e.g. a Strava run) render cardio tiles — **Distance · Duration · Avg HR ·
  Max HR · Pace** — plus a Z1–Z5 time-in-zone bar, instead of the strength
  Tonnage/Sets/PRs grid; hybrid sessions show both. Tiles and the zone bar are
  omitted when the underlying data is absent (no empty "—" noise); pace shows only
  for foot-based modalities. The redundant logged-cardio row on completed sessions is
  dropped. New pure `summariseCardioLogs`; the zone-bar legend aligns each label
  under its segment.

### Strava settings — friendlier connected state (#556)
- Plain-language access line instead of raw OAuth scope tokens; the athlete ID becomes
  a "View on Strava" link; Sync / Connect / Disconnect buttons show pending states;
  Disconnect asks for confirmation.

### Settings review — consistency + de-jargon pass (#555, #561–#563)
- Removed the redundant training-days control from Profile (the plan wizard collects
  days per-block) and the duplicate Strava link from Preferences.
- HR-zone method dropdown: removed exercise-science author names (Karvonen / Friel)
  from user-facing copy and widened the select so the longest option no longer clips.
- Global input padding so native date inputs (notably Events) render consistently with
  the wizard; Events date constrained with `min={today}`; dropped "AMPK / mTORC1" from
  the two-a-day copy; normalised settings hub tile descriptions.
- **Consolidated limitations onto `/app/recovery/injuries`**: deleted the orphaned
  `/app/settings/limitations` route and its parallel "set-and-forget" toggle write
  path (the planner reads both UIs' rows identically — the rich flow is a superset).
  Added a compact **"Quickly block a region"** control that reuses the region-only
  `addLimitation` action and excludes already-blocked regions. No data migration.

### Quick HYROX workout generation
- The Today "Quick workout" sheet gains a **Strength | HYROX** toggle. HYROX shows
  a "what can you do right now?" **station checklist** (Run, Ski Erg, Rower, Sled,
  Sandbag, Wall Ball, Farmers, Burpees) pre-checked from your equipment but
  overridable per generation (e.g. a hotel gym today), plus the usual ~30 / ~60 min
  tiles.
- The generator picks the format **adaptively**: from the stations you checked it
  computes the feasible formats (circuit / compromised run / erg / steady run) and
  generates whichever you're most **overdue** for — grounded in how often the HYROX
  engine programs each (compromised + circuit ~weekly, erg/run ~twice weekly). So
  selecting Run + stations after a while surfaces a compromised run; otherwise a
  circuit. Experience + division come from your active-or-most-recent HYROX plan
  (default intermediate / Open); station loads use the division standard.
- Generated as an off-plan, in-app-loggable cardio session (one block: duration +
  RPE), tagged with its format so future generations read recency. New
  `quick-hyrox.ts` (pure assembler + feasibility) + `quick-hyrox-resolve.ts`
  (experience/division + cadence-grounded format pick).

### Foreign accessory/assistance — staples-first ranking (F1)
- The foreign accessory/assistance injectors (5/3/1, Tactical Barbell, Green
  Protocol) no longer rotate UNIFORMLY over their eligible pool — they now bias
  selection toward the more FOUNDATIONAL movement (lower `experienceMin`), with a
  per-candidate jitter still rotating among equally-foundational staples. Result:
  universal staples (chin-ups, pull-ups, BB/DB/cable rows, lat-pulldowns) lead,
  and niche variants (Meadows / Kroc / archer rows, weighted pull-up) drop out of
  the rotation for advanced lifters instead of appearing as often as staples.
- Selection only, and LOADING-NEUTRAL: sets / reps / intensity stay engine-owned
  and program-specific (5/3/1 25–50 reps submaximal, TB 8–15 near failure). The
  signal is the experience band, NOT loadability, so it prefers the bodyweight
  chin-up over the weighted pull-up — a higher tier only unlocks movements, it
  never makes a session heavier (the Hybrid generator's ADR-0041 loaded-variant
  preference is deliberately NOT ported). New `foreign-accessory-ranking.ts`.

### Green Protocol — opt-in accessory work
- Green Protocol now offers the same opt-in accessory toggle as Tactical Barbell
  (default OFF), per the book's "accessories are optional" guidance. Because GP is
  periodised across multiple TB templates, the per-session cap is resolved from
  each strength session's template (Zulu-HT 3, Operator/Fighter 2) and
  **conditioning days never receive accessories**. Inherits the training-experience
  unlock floor. New `greenStrengthTemplateByRef` helper (`@hta/green`) maps strength
  session refs → TB template; `buildTbAccessoryInjector` gained an optional
  `planForRef` per-session cap resolver. `zulu-ht` added to the accessory template
  gate.

### Training experience → foreign-program assistance (5/3/1, TB, GP)
- The declared training-experience tier (`profiles.training_experience`) now
  gates assistance/accessory selection on the foreign deploy path, where it was
  previously ignored. An **unlock floor** only: beginners/novices no longer get
  skill movements (paused/Olympic/plyometric/advanced-unilateral) they can't yet
  perform; higher tiers unlock them as variety. Selection never honours the
  upper band, so **no universal staple is ever stripped from an advanced
  athlete** (design principle: tier unlocks complexity, never removes staples).
  Applies to 5/3/1 assistance and the opt-in Tactical Barbell / Green Protocol
  accessories. HYROX is intentionally decoupled (it collects its own per-block
  experience in the wizard). Undeclared tier (`null`) is byte-identical.
- Fixed four universal staples — Single-Arm DB Row, DB Bench Press, Russian KB
  Swing, Goblet Squat — that PR W2's curated bands wrongly capped at
  `experience_max = 2`, dropping them for Advanced / Highly-advanced users.
  Migration `0108_uncap_staple_experience_bands.sql` + seed.


Cycle covering PRs #178 → #222 (2026-05-26 → 2026-05-30). Doc refresh on
2026-05-30. The previous starting-point block is preserved below for history.

### Performance (engine — accessory catalog map lookup)- The dynamic accessory picker in `assemble-prescription.ts` resolved each
  pick's catalog entry with `pickerCatalog.find((c) => c.id === ...)` — an O(n)
  scan over the movement catalog per accessory pick. The catalog is now indexed
  once into a `Map<id, entry>` (first-wins insertion, preserving the exact entry
  `.find` returned), making the per-pick lookup O(1). This runs only at block
  creation, so the win is small, but it removes a quadratic-ish hot spot from the
  assembler. Prescriptions are byte-identical (verified: 1431 planner tests pass,
  full suite 3249).

### Performance (session detail — parallelized top-of-page reads)

- The session-detail page (`sessions/[id]`) ran a ~7-query sequential
  waterfall at the top of render (session → profile/feedback prefs → set_logs
  → cardio_logs → session_movements → training-max dict → linked
  planned_session), each blocking on the prior round-trip. These reads are
  mutually independent, so they now resolve in a single `Promise.all`. On a
  high-latency mobile link this collapses ~7 serial round-trips into one,
  cutting a large chunk off the page's time-to-first-byte. No behaviour change:
  the `notFound()` guard still fires when the session row is absent, and all
  downstream derivations are unchanged.



- Quick Workout → Strength (and "Repeat") no longer hangs on a "Starting…"
  button while the destination session page renders. The server actions
  (`startQuickStrengthSession`, `repeatRecentSession`) now **return the new
  session id** instead of calling `redirect()`, and the Today sheet navigates
  client-side via `router.push`. A Server Action `redirect()` blocks the
  caller's transition until the full destination RSC is ready and bypasses the
  route's `loading.tsx`; returning the id and pushing on the client engages the
  existing session-detail skeleton immediately, so the tap feels instant.

### Performance (mobile — launch native shell directly at /app)- The iOS Capacitor shell remote-loaded the site root (`server.url =
  https://getsxc.app`). For a signed-in user, `/` is just the public
  marketing/sign-in landing that runs an auth check and `redirect("/app")` — so
  every cold launch paid for an extra device↔server round-trip plus a couple of
  Supabase auth calls before the real page even started rendering. The shell now
  boots directly at `https://getsxc.app/app`: signed-in users land on Today
  immediately (showing `/app`'s loading skeleton while it renders), and
  signed-out users are sent by middleware to `/login?next=/app` — the preferred
  native first-run anyway. Native-only change; web behaviour is unchanged. Auth
  is unaffected (OAuth callbacks use absolute `/api` paths; Supabase cookies are
  path-`/` scoped). Reaches the device on the next `cap sync` + Codemagic build.

### Added (mobile — native splash screen across remote-load)- The iOS Capacitor shell remote-loads getsxc.app, so a cold launch spent a
  few seconds booting the WKWebView and fetching the site over the network —
  previously revealing a blank webview because the launch image (the branded
  SxC wordmark on iron-dark) vanished the instant the webview was created. The
  splash is now managed by `@capacitor/splash-screen` with
  `launchAutoHide: false`, so the branded screen stays up across that gap and is
  dismissed — with a 250ms cross-fade — only once the first route has hydrated
  and painted (`SplashScreenController`, which calls the plugin over the
  injected `window.Capacitor` bridge so the web bundle stays native-dep-free
  under remote-load). A double-`requestAnimationFrame` defers the hide one frame
  so content is on-screen before the fade; a 5s safety timeout guarantees the
  splash never hangs on a hydration stall, and the offline `www` fallback shell
  hides the splash itself so an unreachable site shows "Connecting…" rather than
  a frozen splash. This does not make the remote fetch itself faster, but it
  replaces the blank-webview cold-start with a branded screen so the launch
  feels intentional and instant.

### Added (mobile — native Taptic-Engine haptics)

- `lib/feedback/hapticTick` now prefers the native **Taptic Engine** when the
  app runs inside the Capacitor shell, calling the `@capacitor/haptics` plugin
  over the injected `window.Capacitor` bridge (mapping the legacy vibration
  duration onto a LIGHT/MEDIUM/HEAVY impact). This is the only path that produces
  a real buzz on iPhone — iOS Safari never implemented the Web Vibration API — so
  the set-logged tick and rest-timer-done cue now actually fire on iOS. On plain
  web it falls back to `navigator.vibrate` (real on Android, no-op on iOS
  browsers). One codebase, progressive enhancement; the web bundle adds no native
  deps. So the rest timer + set logger give eyes-free confirmation on iPhone.
- Native shell cleanup: dropped the dead `@capacitor-community/background-geolocation`
  plugin and removed the background-location `Info.plist` keys
  (`NSLocationWhenInUse*`, `NSLocationAlwaysAndWhenInUse*`, `UIBackgroundModes:
  location`) — leftovers from the removed in-app cardio tracker. The shell now
  requests no location permission. Added `@capacitor/haptics` in its place.
  (Native push via APNs/FCM remains gated on the $99/yr Apple Developer Program +
  a backend send pipeline — see `docs/knowledge/mobile-platform-notes.md`.)

### Added (mobile — screen wake lock during active sessions)

- The screen now stays awake while a workout session is in progress so the
  rest timer + set logger remain visible instead of the phone auto-locking
  mid-session. New `lib/pwa/wake-lock.ts` controller + `SessionWakeLock`
  component (mounted on the session page, gated `!isComplete`); re-acquires
  on `visibilitychange` → visible because the OS auto-releases when hidden.
  W3C Screen Wake Lock API — iOS 16.4+ Safari and Android Chrome; best-effort
  no-op elsewhere. This restores wake-lock coverage that previously lived only
  in the now-removed cardio tracker, and extends it to strength/hybrid sessions.
- New `docs/knowledge/mobile-platform-notes.md` documents the PWA capability
  matrix and known per-OS limitations (iOS has no Web Vibration API so haptics
  no-op on iPhone; web push is install-gated on iOS) plus an Android parity
  checklist. Records that a Capacitor wrapper is the lever for native iOS
  haptics + push if those become priorities.

### Changed (cardio capture is Strava's job — in-app GPS removed)

- Strategic pivot: the app's differentiator is the training ENGINE
  (prescriptions, load, concurrent interference, taper), not re-creating
  Strava in-app. Cardio is captured in Strava/wearables and flows into the
  engine via the existing Strava integration (load + HR zones + interference).
  In-app cardio capture has been removed accordingly.
- Removed the in-app live GPS cardio tracker entirely: deleted
  `LiveCardioTracker`, the `lib/cardio/geo-provider` + `live-tracker` modules,
  and their tests. Planned cardio sessions now render the manual `CardioLogForm`
  (RPE / duration / distance / notes) — and, when Strava is connected, the
  existing `StravaAutofillBanner` "Sync now" / "Use" flow to pull a matched
  activity. No GPS permission is requested anywhere in the web app.
- Quick workouts are now STRENGTH-ONLY. The Today "Quick workout" sheet drops
  the Run / Ride / Other tiles and the duration picker; it offers a single
  Strength start plus a Recent list of completed strength workouts to clone.
  Steering ad-hoc cardio out of the quick picker reinforces "cardio happens in
  Strava." Removed the `startQuickCardioSession` server action + schema and the
  cardio-cloning path in `repeatRecentSession`; `getQuickRepeatCandidates` now
  returns strength sessions only.
- Migration 0085 columns (`sessions.quick_cardio_modality` +
  `quick_cardio_duration_sec`) stay in place but are no longer written — they
  remain readable for legacy quick-cardio sessions, which now render the manual
  form instead of the deleted tracker. No drop migration.

### Fixed (native cardio — Quick run/ride now opens the live tracker, Phase 0)

- Strava import now computes `avg_pace_sec_per_km` for distance-bearing
  activities (`pace = duration / distance`, sec/km). Previously the import row
  builder (`lib/integrations/strava/sync-row.ts`) left pace NULL, so pace PRs
  (`lib/stats/pace-prs.ts`, run modality) never populated for imported runs.
  Migration 0086 backfills the column on existing Strava-sourced rows that have
  a positive distance and no pace yet — historical imports light up immediately.

- Quick run / ride (Today "Quick workout" sheet) now opens the live GPS
  tracker (running clock + distance + pace + screen wake-lock) instead of a
  bare read-only "run / 90 min + finish" card. The quick-cardio flow used to
  pre-insert a `cardio_logs` row, which tripped the session page's
  `hasLoggedCardioRow` guard and gated the live tracker OUT. It now records the
  quick-cardio intent (modality + target duration) on the session row and
  writes the real `cardio_logs` row on finish via the unchanged
  `logCardioSession` action.
- Migration 0085: `sessions.quick_cardio_modality` + `quick_cardio_duration_sec`
  (both nullable; NULL = every existing/non-quick session, byte-identical prior
  behaviour). First step of the native cardio Strava-parity roadmap (route map,
  elevation, splits, Bluetooth HR follow on).
- Quick cardio sessions no longer render the strength "Pick movements to start
  logging" empty-state card under the live tracker. A cardio-only session now
  presents ONLY its modality (the tracker + its own Finish CTA) — the
  `AddToWorkout` strength entry is gated out for pure-cardio sessions
  (`!isPureCardio`). The empty-state predicate fired because a quick-cardio
  session has no prescription and no logged row until finish; that strength
  nudge was noise on a cardio workout. Hybrid and strength sessions are
  unchanged.

### Added (antagonist-superset accessories, engine machinery — ADR 0026)

- **Pure pairing module + superset-aware duration estimate (P1 + P2 of ADR 0026).**
  Lays the foundation for antagonist supersets (e.g. biceps curl + triceps pushdown
  rested once per round instead of twice) without changing any behavior yet. New
  `lib/planner/antagonist-pairs.ts`: an anatomical reciprocal-antagonist classifier
  (elbow flex/ext, knee ext/flex, horizontal push/pull, ankle plantar/dorsi — true
  isolation antagonists only) plus a pure post-selection pass that tags paired
  accessories via `meta.supersetGroup`/`meta.supersetSlot` and pulls each A2 partner
  adjacent to its A1 (A1 keeps its priority slot). `estimateSessionSeconds` gains a
  meta-gated branch that prices a valid pair as one overlapped rest + a short station
  switch per round (`SUPERSET_TRANSITION_SEC = 15`, a tagged CP-1 heuristic), saving
  ~75 s/round; a "widowed" member whose partner was trimmed (ADR 0013 autoreg slice)
  is priced solo. **No behavior change:** pairing is unwired (lands at P4 behind a
  default-off preference), and with no superset meta present the estimator reduces to
  its exact legacy per-item computation — byte-identical, full suite green.

- **Antagonist-superset opt-in preference (P3 of ADR 0026).** New profile-level
  `superset_accessories` boolean (migration 0084, DEFAULT false) plus a "Pair opposing
  accessories into supersets" toggle under Settings -> Preferences -> Training style.
  An execution style applied to all blocks (like haptics / timer-sound), wired through
  the same RLS-safe `updateProfile` path (present-sentinel + `on` checkbox convention,
  user-scoped client, `.eq("id", user.id)`). The toggle is honest about the trade-off
  (shorter session, same work, modestly higher perceived effort). **No behavior change
  yet:** the preference is not consumed by the planner until P4 — every existing row
  defaults OFF and reproduces today's prescription + duration byte-identical.

- **Antagonist supersets now actually group your accessories when enabled (P4 of
  ADR 0026).** With the Settings toggle on, the plan / preview / session views pair
  opposing accessories (e.g. a curl with a pushdown) into A1/A2 supersets and show the
  shorter resulting session time. Pairing is a read-time presentation layer applied
  after the autoreg trim, so it **never changes which exercises or how many sets you
  get** — it only regroups what you'd already do and rests you once per round instead
  of twice. The preference is live (flip it and the current block regroups on the next
  view); stored prescriptions and logged sets stay pairing-free. New
  `lib/planner/superset-view.ts` (`applySupersetPairing` + an RLS-safe muscle resolver)
  wired into the two planner read seams. **No change for users with the toggle off:**
  the read path returns the prescription untouched, byte-identical to before.

- **Plan and Preview now show antagonist pairs as a labelled superset (P5a of
  ADR 0026).** When the toggle is on, the accessory lists on the plan day-drawer
  and the workout preview wrap each antagonist pair in a "Superset · alternate,
  rest once" bracket so you can see at a glance which two accessories are meant to
  be done back-to-back. A pair trimmed down to one survivor (or whose partner lands
  in a different render section) falls back to a normal solo row — never a
  half-bracket. New pure `lib/plan/superset-grouping.ts` (`segmentSupersetRows`)
  folds the flat accessory list into solo rows + superset clusters; the
  toggle-off / unpaired list is structurally identical to before. (The live
  in-workout logger gets the same grouping next — P5b.)

- **The live in-workout logger now groups antagonist pairs too (P5b of ADR 0026).**
  With the toggle on, the per-movement card list on the active session screen pulls
  each paired accessory's two cards adjacent and wraps them in the same "Superset ·
  alternate, rest once" bracket as plan / preview, so the grouping the lifter saw
  while planning carries through to execution. Crucially the underlying
  `prescription.items` order is left untouched — the logger matches logged sets to
  items by stored positional index, so only the CARD render is regrouped (new
  `lib/sessions/superset-cards.ts`: `buildSupersetByMovementId` derives membership
  from the unpaired prescription, `segmentAccessoryGroups` clusters the cards). The
  rest timer stays per-card/advisory for now; automated cross-card "rest once per
  round" coordination is a deliberate follow-up. Toggle-off / no-pairs renders the
  exact legacy card layout (empty membership map). Full suite 3279 green, build clean.

- **Antagonist-superset feature complete — paired time + constants doc (P6/P7 of ADR
  0026).** Closes out the antagonist-superset work: the Plan and Preview surfaces already
  show the shorter paired duration (they price the P4-paired read-path items through the
  superset-aware `estimateSessionSeconds`), now pinned by a minute-wrapper paired-vs-solo
  surface-contract test so the shown `~N min` can't silently regress to the un-paired
  number. The new `SUPERSET_TRANSITION_SEC = 15` constant is documented as CP-2 row 47
  (Robbins 2010 / Weakley 2017 antagonist-pairing evidence; CP-1 heuristic for the 15 s
  station-switch magnitude, which only affects the displayed estimate, never prescription)
  in both the canonical workspace constants doc and the `docs/knowledge` mirror.

### Added (intensity-aware concurrent interference — ADR 0025)

- **The concurrent-cardio volume pull-back on the Stats chart is now
  intensity-aware.** Previously the muscle-volume "concurrent" modifier weighted
  cardio by *modality* only, so a week of easy Z2 miles and a week of the same
  duration in VO2/threshold intervals compressed your displayed volume targets
  identically. The interference contribution of each logged cardio block is now
  additionally weighted by a time-in-zone intensity multiplier, anchored at the
  Z2 reference: Z2 → ×1.0 (unchanged), threshold/VO2 → a premium, recovery-zone →
  a discount. The premium is per-minute and hard sessions are short, so long easy
  volume stays the dominant interference source. **Stats/display only** — this
  does not touch `buildPrescription` or the ceiling chain (CP-4: no
  `interference_modifier` is introduced). Only objective `hr_zones` data earns an
  adjustment; RPE-only and no-data blocks fall back to ×1.0, so every user without
  HR-zone data sees **byte-identical** output and all continuity pins hold. Reuses
  the existing `ZONE_INTENSITY_WEIGHTS` (ADR 0009) — no new intensity constants.
  New per-block entry point `computeConcurrentScalarFromBlocks` +
  `cardioBlocksFromLogs` builder; the modality-record `computeConcurrentScalar`
  stays as an intensity-blind back-compat wrapper.

### Added (tendon-floor guarantee — ADR 0024 addendum)

- **The weekly connective-tissue floor is now an enforced, tested invariant.**
  Guarantees every generated week ships the DC-O4 tissue-stack floor (heavy
  isometric, HSR, plyometric, 2× carry) for every archetype × frequency ×
  accessory-volume level × week — so the Low/Med/High lever (or any future
  engine change) can never silently drop below it. The accessory picker already
  filled the durability floor first, so this is mostly a lock-in: a full-matrix
  gap map found exactly one real gap — beginner/novice onboarding-ramp weeks
  dropping the 2nd weekly carry on maintenance — because the ramp shrank the
  per-session budget. Fixed by giving the picker **two caps**: a total ceiling
  that holds a floor/functional reserve **outside** the onboarding ramp, plus a
  separate aesthetic-only cap (`aestheticMaxItems`) that keeps the original
  ramped hypertrophy budget so the reserve can't leak into extra accessory
  volume. **Byte-identical** for every non-beginner prescription (ramp = 1.0);
  golden master unchanged. New pure module `lib/planner/tendon-floor.ts`
  (`contextualFloor` / `countFloorRoles` / `checkTendonFloor`, with plyometrics
  correctly suppressed for tendinopathy + beginner/novice) and a cross-archetype
  invariant test drive the production week path to assert the floor every week.
  Equipment-impossible floors (e.g. bodyweight-only, no loaded carry) remain the
  honest residual covered by the existing runtime tissue-stack warning.

### Added (accessory volume — live estimates + recommendation, ADR 0024 addendum)

- **Accessory-volume control now shows on every plan + recommends a level.**
  Follow-up to ADR 0024. The Step 4 control is no longer hidden on cardio-led /
  rebuild / maintenance plans — it renders on **every** priority combination so
  the setting never silently disappears. Each level (Low / Medium / High) now
  carries a **live ballpark time estimate** for one strength workout, computed by
  a new read-only preview action (`estimateAccessoryVolumeMinutes`) that reuses
  the exact engine path — `assemblePrescriptionItems` + `estimateSessionMinutes`
  (the same set-aware estimator the ADR 0020 duration governor uses) — so the
  number the user sees equals what the engine budgets to (High already reflects
  the governor trim). The wizard **pre-selects an engine-recommended level** with
  a one-line reason (strength→Medium, hypertrophy→High, concurrent→Medium,
  endurance/rebuild→Low; a `muscle` secondary bumps up one level), advisory only —
  the reducer never stomps a level the user picked. Archetypes whose accessory
  base is already minimal (endurance / rebuild) show an honest "Low = Medium here,
  High adds the extra work" note; Maintenance (zero accessories) shows the control
  **disabled** with an explanation rather than hidden. Zero engine-regression
  risk: no edits to `createBlock`, the assembler, or the engine — the estimate is
  a separate read-only path and the DB default stays `medium` (byte-identical
  guarantee preserved).

### Added (accessory volume level — ADR 0024)

- **Per-block accessory-volume control (Low / Medium / High).** A new
  block-wizard lever (Step 4 · Review) lets the user dial how much
  *accessory* work a strength day carries, deliberately split from the
  ADR 0016 effort axis — Low trims volume without softening how hard the
  remaining sets are (heavy compounds + AMRAP top sets stay). `Medium` is
  the default and is **byte-identical** to the pre-feature prescription on
  every archetype (migration 0083 backfills `training_blocks.accessory_volume`
  to `'medium'`, and the golden master + every ADR 0011/0015/0016/0020/0022
  pin stays green). `Low` trims exactly one aesthetic accessory movement
  (breadth, not depth — the kept movements keep their full set count, and the
  durability/functional floor is untouched); `High` adds one movement plus one
  set per movement, bounded by the ADR 0020 session-duration governor. The
  control composes additively with the secondary-focus tilt at the same
  assembler site, is floored against each archetype's own accessory profile
  (a no-op on cardio-led / rebuild / maintenance blocks, which are already at
  their accessory floor — the wizard hides the control there to avoid a dead
  knob), and only ever moves aesthetic accessories: main lifts, cardio,
  durability and functional work are identical across all three levels.
  Magnitudes are CP-1 [DEF→cal] heuristics (Schoenfeld 2019 low-volume;
  Currier 2023; Baz-Valle 2022). Supersedes the ADR 0016 hypertrophy-only
  accessory VOLUME axis, which is retired (its EFFORT axis is unchanged).

### Added (stats page redesign — Direction C2, Phase 3 · drawers)

- **Endurance & Consistency tiles now open detail drawers, and the
  bottom deep-dive grid is demoted to a slim footer (Phase 3c).** The
  Endurance tile gains a "Detail →" drawer showing a weekly easy-pace
  sparkline (the per-week mean-pace series `classifyPaceSlope` already
  computed internally and discarded — now exposed as `weeklyPace[]`,
  display only), the easy/dropped run counts, and the **full
  time-in-zone breakdown** (absolute minutes per zone, the user's bpm
  band edges, polarised easy/threshold/hard split, activity count and
  whether the distribution is measured vs estimated) — far more than the
  tile's relative bars. The Consistency tile gains a drawer with a
  week-by-week rhythm list, current-streak / weekly-target / active-weeks
  / strength-to-cardio summary stats, and a deep link to the full
  Adherence dashboard. With every tile now interactive, the four
  prominent deep-dive **cards** at the page bottom collapse into a single
  low-emphasis "Full pages" text-link row (PRs · Engine · Blocks ·
  Adherence) — the full subpages stay reachable, just de-emphasised.
  No prescription path touched; all new surfaces are read-only history.

- **Recovery & load tile now opens an acute:chronic drilldown drawer.**
  The Recovery & load tile's header "Engine →" link is replaced by a
  "Detail →" affordance that opens a side drawer (same shared
  `BottomSheet` primitive). The drawer surfaces the readiness verdict +
  confidence ("N of 3 signals agree" / "building baseline"), the
  acute:chronic workload ratio on a 0–2.0 gauge with band threshold ticks
  (0.8 / 1.3 / 1.5) and a Gabbett-2016 sweet-spot legend, a cold-start
  notice when there is &lt;4 weeks of load history, and the three
  corroborating signals (load balance, sRPE drift, output trend) the
  readiness verdict is composed from. A footer states the readiness signal
  is **display only — it never feeds workout prescription** and deep-links
  to `/app/stats/engine` for the full internals. Reuses the existing
  `getReadiness` payload — no new query, no engine input.

- **Strength tile now opens an e1RM detail drawer.** The Strength
  progress tile gains a "Detail →" affordance that opens a side
  drawer (reusing the shared `BottomSheet` primitive — desktop
  right-panel / mobile bottom-sheet, Escape + backdrop + scroll-lock).
  Each main lift shows a `Sparkline` of its estimated-1RM trend, the
  kg/week slope + direction, session count and latest e1RM, and a "Full
  history →" deep link to `/app/stats/movements/{slug}`. The series is
  the **same** top-set-per-session e1RM data the tile's verdict is
  already fit over — `getStrengthProgress` computed it internally and
  previously discarded it; it now exposes `points[]` + `slug` per lift
  (display only, never an engine input). No prescription path touched.

### Changed (stats page redesign — Direction C2, Phase 2)

- **`/app/stats` is now a command-center bento.** The flat card grid is
  replaced by an answer-first hero band — **Progress** verdict ·
  **Readiness** composite · **Consistency** streak — over a six-tile
  bento (Strength progress · Endurance progress · Recovery & load ·
  Consistency rhythm · Bodyweight · Training volume). Endurance is now
  co-equal with strength rather than buried. Phase 1 (PR #226) shipped
  the five new tested query modules (`strength-progress`,
  `endurance-progress`, `progress-verdict`, `weekly-rhythm`, `streak`);
  this phase wires them into the new `StatsCommandCenter` client
  component and rewrites the `/app/stats` server page. The global range
  toggle (30d / 90d / all-time, URL-synced) is preserved.
- **Honesty posture (no hardcoded numbers).** Every value traces to a
  real query. There is deliberately **no "stress budget" meter** — the
  Recovery & load tile and the hero Readiness cell render the
  ACWR-grounded readiness composite (`readiness.ts`), not a fabricated
  budget percentage. The sixth tile is **Training volume** — weekly
  tonnage (Σ weight × reps, working sets only) from `getVolumeForRange`,
  range-aware like the rest of the bento. Cold-start states ("building" /
  "no run data") are honored rather than rendering misleading zeros.
- **Decision-trace card pulled from the overview (honesty fix).** The
  earlier "Why today looks like this" tile read as if the engine adapts
  the session day-of; in reality every workout + prescription is
  materialized at block creation (`createBlock` → one bulk
  `planned_sessions` insert) and `getDecisionTrace` only *describes* the
  fixed plan. Rather than reword a forward-looking card on a page whose
  job is retrospective overview + historical deep-dive, the tile is
  removed from `/app/stats` and replaced by the Training volume tile. The
  decision trace still lives on the **Engine internals** deep-dive
  (`/app/stats/engine`), an appropriate power-user surface;
  `getDecisionTrace` and its tests are untouched.
- **The 20-week training heatmap is removed from the overview.** Its
  `TrainingHeatmap` component + `training-heatmap-data` query are kept
  (with tests) for a potential Phase-3 drawer but no longer mount on the
  page. This **supersedes** the earlier Readiness-card placement note
  below ("between the current block strip and the training heatmap"):
  the readiness composite is now the hero's middle cell. The
  `calendar-heatmap` e2e spec is dropped and `stats-overview-desktop`
  is rewritten for the new bento.

### Removed (engine + UX simplification — ADR 0018)

- **Retired the daily wellness check-in and dropped the ceiling chain to
  two factors.** The per-day fatigue/soreness check-in (whose input card
  was already retired in PR #176) is gone end-to-end: the daily
  `recoveryMultiplier` engine path (`wellness-recovery.ts`) and its
  `/app/stats/wellness` view are deleted, and the global ceiling is now
  `finalCeiling = baseCeiling × confidenceBias` (was
  `× recoveryMultiplier ×`). Because no surface had written fresh daily
  fatigue/soreness since #176, that multiplier was a constant `1.0` for
  everyone — so the removal is **behaviour-neutral on every prescription**.
  The daily log is reduced to bodyweight only. **No DB migration:** the
  `wellness` table columns (`fatigue` / `soreness` / `motivation` /
  `notes`) are retained for history + data export, and
  `wellness.bodyweight_kg` stays a live feature. The per-session GRM
  (`grm.ts`, deload/advisory) is a separate, untouched signal. AI
  knowledge, both system prompts, `getEngineState`, glossary, cmd-k, and
  privacy copy updated to the two-factor chain. CP-4 updated from "stays
  at 3 factors" to "stays at 2 factors".

### Added (post-#215 wave)

- **Readiness composite stats card (ADR 0019).** A new body-wide
  "are you absorbing the work?" surface at the top of `/app/stats`
  (between the current block strip and the training heatmap). It
  combines three honest signals that were already collected as a side
  effect of normal logging — EWMA-ACWR over `region_state` (body-wide
  ΣATL / ΣCTL with `detraining / productive / pushing / spiking`
  bands), sRPE drift (`rising / stable / easing / no-data` from the
  existing 4-week-vs-4-week query), and PR cadence (recent 28d vs prior
  28d unique-movement count) — into a single verdict
  (`building / detraining / productive / pushing-tolerated / watch /
  overreaching`) with a confidence chip (`agree` when all three signals
  point the same way as the band, `mixed` otherwise, `building` below
  4 distinct ISO weeks of data). Banded acute:chronic gauge with
  triangle marker, expandable drill-down with scalar Fitness / Fatigue
  / Form, four signal cards, formula, and inline citations. **Hard
  constraint:** does NOT feed `buildPrescription` or
  `getCeilingExplain` — read-only stats overlay; CP-4 stays two-factor.
  Bands (0.8 / 1.3 / 1.5 — Williams 2017 / Gabbett 2016 lineage with
  Lolli 2019 / Impellizzeri 2020 critique) are tagged HEURISTIC / CP-1
  with per-user calibration deferred to v2. 30 new pure unit tests
  pin the band boundaries, cold-start gate, and verdict matrix.
  Doesn't measure autonomic recovery (no HRV, no sleep) — the card
  states this caveat verbatim. CP-2 row #45.

- **Hardened, versioned data export (`export-v1`).** The "Export my data
  (JSON)" download (Settings → Account) now covers **every** user-authored
  table — training maxes + their history, training blocks, planned sessions,
  off-plan session movements, races, AI memories + chat history, bodyweight
  progression, prescription edits, and engine overrides — not just the
  previous 8-table subset, making the GDPR Art. 15/20 "complete record"
  claim honest. Adds a `format_version: 1` integer with an additive-only
  stability contract, a self-describing `excluded` section (secrets +
  derived/recomputable tables are listed, never dumped), portable movement
  slugs on every movement-referencing row, a new `docs/export-format.md`
  contract doc, and a route test that fails CI if a covered table is dropped
  or a secret/derived table ever leaks in. Read-path only — no migration, no
  new write surface, no engine math.
- **Ranked cardio-modality preference (ADR 0017).** A new setting
  (Settings → Training → "Cardio types", also offered in onboarding)
  lets you pick which cardio forms the planner programs by default — in
  priority order — instead of always defaulting to running. The planner
  substitutes the prescribed running movement for your top feasible
  modality at the **same intensity** (gated by owned cardio equipment +
  experience tier); if no preferred modality has a movement of the
  needed intensity it falls back down your list and finally to running
  (the only modality with a full intensity ladder). Selection-only and
  **load-neutral** — a cardio session's training stress comes from its
  kind + duration + HR cap, so swapping the movement changes no engine
  math. Leaving the preference empty reproduces today's behaviour
  byte-for-byte. Stored in `profiles.preferred_cardio_modalities`
  (migration 0081).
- **Hypertrophy early-set effort bump (ADR 0015).** The earlier
  (non-final) compound sets of the hypertrophy archetype — previously
  ~RIR 6–10 junk volume — now get a bounded rep bump (`+2`, capped at
  12) and an honest "make it challenging" cue on non-deload weeks.
  Deliberately **no** RIR-3-4 label: inverting the Helms/Zourdos RPE
  chart shows literal RIR 3–4 at these light loads (54–67% 1RM) would
  mean ~12–15 reps/set — a volume explosion the default avoids. Loads,
  the ADR 0011 final-set anchor, the deload week, and folded
  secondaries are unchanged. True RIR 3–4 / higher volume becomes
  opt-in via the effort/volume dial (ADR 0016).

- **Effort & volume dial (ADR 0016).** A new profile setting (Settings →
  Profile → "Effort & volume": Easier / Balanced / Harder) lets you tune
  how hard and high-volume the hypertrophy archetype's muscle work is.
  One control moves two axes together — compound proximity-to-failure
  (the ADR 0015 early-set bump + the final-set RIR) and accessory
  sets-per-movement. "Balanced" is the default and reproduces today's
  plan exactly; "Harder" pushes toward the productive 10–12 sets/muscle
  range (but never to failure on a compound — RIR is floored at 1);
  "Easier" backs both off for fatigue-heavy phases. Hypertrophy-only and
  applied to your next created block; every other archetype is
  unchanged.

- **Quick workout UX sweep (PR #222).** Inline duration chip picker
  (30 / 45 / 60 / 90 / Custom) on the QuickWorkoutSheet replaces the
  30-min hardcoded default; single `+ Add to workout` button replaces
  the parallel `+ Add off-plan movement` regression; edit cardio page
  shows Duration in minutes and Pace in `M:SS/km` (or `/mi` per
  profile units) via a new shared `lib/cardio/units.ts` helper;
  context-aware edit page (prescription-only fields when no metrics
  logged, full fields after, read-only when Strava-synced); strength
  empty-state placeholder; "Edit cardio block" renamed to "Edit cardio
  session"; hybrid finish bar now says "Log at least 1 strength set
  to finish".
- **Today hero card uses `SessionPreviewBody` (PR #220).** New
  `variant="compact"` strips chrome, keeps the structured rows. Killed
  the bespoke `TodayHeroSummary` to eliminate alignment drift between
  hero and Preview. Dropped the "Preview workout" secondary link (now
  redundant) and the standalone `~N min` topline (duration lives in
  the structured row). Moved Quick workout card above This Week.
- **Focus muscle groups (PR #221).** Per-block aesthetic specialisation:
  user picks 0–2 muscles from a 12-group allowlist; engine applies a
  substitution-with-cap bias that pushes focus muscles toward
  concurrent-adjusted MAV while pulling non-focus muscles down to
  preserve total session set count (invariant pinned by tests).
  Includes a forearm tendon-gate that silently downgrades forearm
  volume when elbow/forearm regional ATL is elevated. Wizard Step 2
  chip multi-select + Plan-page edit modal + Today hero focus badge.
  Migration 0079 (`training_blocks.focus_muscles text[]` with size + 
  allowlist CHECK constraints).
- **Taper + post-race recovery lifecycle (PR #219).** Replaces the
  advisory taper card with an interactive opt-in banner on Today
  (Apply / Decline / Undo states), adds a `RaceCheckInCard` the day
  after `event_date` (raced / partial / skipped), and a
  `RecoveryBanner` with the same opt-in pattern. `computeRecoveryWindow`
  scales recovery duration by event distance × modality × user tier ×
  priority (running 5K/10K/HM/marathon/ultra anchors; cycling 0.5×;
  swim/row 0.35×). Engine integration applies active modifications in
  `buildPrescription` (taper / recovery / ramp scaling). Migrations
  0077 (`prescription_modifications` table) + 0078 (RLS policy fix
  caught by review).
- **Cardio hero card consistent for all kinds (PR #218).** Z2, tempo,
  alactic, and mixed sessions get the same hero treatment as VO2 (was
  bare HR cap line). New `cardioOneLinerForKind` short-form
  descriptions + kind-based Intensity fallback in `cardio-preview-rows`
  so the Intensity row is always emitted. Cross-kind regression test
  iterates every key in `CARDIO_DESCRIPTIONS`.
- **`.mailmap` contributor consolidation (PR #217).** Non-destructive
  remap collapses 11 historical author identities to drrowdev + Copilot
  on GitHub's contributors page.
- **Shared strength-prescription helper fully unified (PR #214).**
  `finishStravaAppliedSession` was the one remaining call site with an
  inline `session_items` count instead of `sessionPrescribesStrength`;
  external code review caught it. Now all 4 hybrid-completion guard
  paths consume the shared predicate.

### Migrations (post-#215)

- **0077** — `prescription_modifications` (taper + recovery audit table)
- **0078** — RLS policy fix for `prescription_modifications` (review-219 catch)
- **0079** — `training_blocks.focus_muscles text[]` with size + allowlist CHECK

### Added

- **AI architecture — Explain v1 + BYOAI (ADR 0002).** In-app chat surface
  (ChatFAB → drawer) backed by a pluggable `LlmProvider` (Anthropic /
  OpenAI / Gemini) with bring-your-own-key storage in a pgcrypto-encrypted
  vault. New `getEngineSnapshot` tool, eval fixtures, and observability
  scaffolding. User keys never leave the server vault; the orchestrator
  speaks to providers from the edge runtime. Migration 0069 (AI plumbing).
- **MCP server + 8-tool catalogue (ADR 0003).** Streamable HTTP MCP
  endpoint at `/mcp/[...mcp]/route.ts` with OAuth 2.1 authorization-code
  bridge, PKCE, scope gating, and a shared 8-tool catalogue used by both
  the in-app chat and external MCP clients. Authorization codes are
  single-use (`mcp_consumed_codes`), bearer tokens are HMAC-signed via
  `MCP_TOKEN_SIGNING_KEY`. Orchestrator v2 (PR #195) routes the in-app
  chat through the same tool catalogue. Migrations 0071, 0072.
- **Strava integration end-to-end.** Push-subscription webhook
  (`/api/integrations/strava/webhook`) with idempotent
  `strava_event_log` dedup, single-activity sync on create / update,
  full historical import, an onboarding step (second-to-last), and a
  3-state autofill banner on cardio sessions (suggested → applied →
  ready-to-finish). Manual `pnpm --filter @hta/web run strava:subscribe`
  registers the subscription once per environment. Migrations 0075, 0076.
- **Engine — archetype rebalancing.**
  - **ADR 0004:** Endurance Focus now prescribes a *dual* main lift
    (squat + hinge) post-Huiberts 2024; companion fix trims the
    Concurrent Hybrid template to match.
  - **ADR 0005:** frequency-aware dual-main-lift *folding* — when the
    weekly slot budget is tight, secondary main lifts fold into the
    primary day instead of being dropped.
  - **ADR 0006:** demote bench-press / overhead-press anchors in
    Strength + Hypertrophy archetypes so folding can balance low-
    frequency weeks symmetrically.
- **Hybrid completion guard.** Shared `sessionPrescribesStrength` helper
  prevents hybrid sessions from auto-completing on a cardio log alone.
  Adopted by `logCardioSession`, `applyStravaAutofill`,
  `finishStravaAppliedSession`, and the `importStravaHistory` auto-link
  path. Migration 0074 adds a `cardio_logs` finish-uniqueness
  constraint as a belt-and-braces backstop.
- **Mobile UX overhaul.**
  - Scrollable `/plan` calendar + mobile nav cleanup (#200), month-view
    prev/next + title (#201), MORE tab → settings + week-only plan
    view + full-screen swipe-dismiss drawer (#202).
  - Preview-workout route — secondary CTA shows session details rather
    than the whole plan (#203, #204).
  - Today hero at-a-glance summary, deduped HR cap, copy unified on
    "workout" (#206, #207).
  - Cardio session rebuild — in-session log form + descriptions +
    layout (#208), full active-session UX overhaul + Strava autofill
    wiring (#209), Mockup B + shared RPE button-grid picker + unified
    "+ Add to workout" affordance (#210).
- **Limitations v2 lifecycle (#189).** Bilateral side + muscle-level
  filter + per-exercise allow + event lifecycle (active / paused /
  resolved) + Today banner. Migration 0070.
- **Per-region load-spike warning banner on Today (#184).**
- **Beginner-only accessory volume ramp for the first 3 weeks (#183).**
- **Quick workout entry on Today (#213).** Inline dashed card + bottom-
  sheet picker + three server actions (`startQuickCardioSession`,
  `startQuickStrengthSession`, `repeatRecentSession`) for off-plan and
  rest-day logging without going through the planner.
- **Settings — Integrations sub-hub + cancel workout (#215).** Strava
  and AI consolidated under a single `/app/settings/integrations` hub;
  plain-language labels on the HR-zone method picker (%Max / %HRR /
  %LTHR); a Cancel workout button surfaces on empty in-progress
  sessions so abandoned starts no longer pile up in history.
- **HR-zone configuration (#161, #162, #172).** Three methods (%Max,
  %HRR, %LTHR) with editable percentages per method; cardio logs from
  Strava populate `hr_zones`; engine consumes HR-aware buckets and per-
  region load when zones are available (#167).
- **External cardio source plumbing (#159, #160).** Planner reserves
  cardio days and defers prescription when the external source is the
  ground truth; classifier infers cardio kind from HR + duration.

### Changed

- **AI settings UI.** Dropped the master opt-in switch in favour of
  collapsible MCP + BYOAI cards (#196); rewrote the key-storage
  disclaimer for end users (#190); added an inline `i` button explaining
  storage + privacy (#188); adopted the punchier "Bank-level encryption"
  framing (#191). Migration 0073 drops the legacy `profiles.ai_opted_in`
  column.
- **Engine — modality-aware concurrent-training scalar (Stage A,
  #181).** Continuous scalar replaces the prior discrete buckets.
- **Engine hygiene (#178, #180).** Consolidated actual-session-load
  reads onto a single helper; deduped `CARDIO_SCALAR`; tightened the
  alactic classifier; documented the recovery-scale split.
- **Daily wellness sliders feed `recoveryMultiplier` (#166).**
- **Effective stress load recomputed from logged sets + cardio (#165).**
- **Cardio-swap UX (#168, #158, #157).** Excludes unclassified
  movements from the intensity-matched picker; per-card swap; plain-
  language cardio protocols; larger disclosure arrows.
- **Wellness — retired the standalone daily check-in card on
  Today (#176)** now that the engine reads sliders directly.
- **Retroactive `performed_at` + late-logged adherence breakdown (#174).**
- **Plan overdue badge + always-today agenda cursor (#173).**
- **`/plan` polish (#205).** Remove block tooltip, add overdue count,
  unify history link styling.

### Fixed

- Use the shared strength-prescribed helper in
  `finishStravaAppliedSession` so a hybrid session whose strength block
  is unlogged can't be marked complete from a Strava finish (#214).
- Anchor adherence requires a logged anchor set and uses main-lift role
  names for the filter (#163, #164).
- Mobile preview-workout readability + truly hide the desktop plan
  timeline on mobile (#204).

### Security

- `MCP_TOKEN_SIGNING_KEY` (≥ 32 chars) is a hard runtime requirement on
  any deployment that exposes `/mcp/*`.
- Strava webhook handler validates `subscription_id` against
  `STRAVA_WEBHOOK_SUBSCRIPTION_ID` and dedupes on
  `(subscription_id, event_time, object_id, aspect_type)` via the
  `strava_event_log` unique index (0075, 0076).
- BYOAI key vault uses pgcrypto with `AI_KEY_ENCRYPTION_KEY` as the
  master key; vault RPCs scope every read/write to the calling
  `user_id` (defense in depth on top of RLS).
- Hybrid completion guard prevents a cardio log from prematurely
  marking a strength-bearing hybrid session as complete.

### Removed

- `profiles.ai_opted_in` (migration 0073) — replaced by per-provider
  configuration in the AI settings card.

### Migrations

0069 AI plumbing · 0070 limitations v2 lifecycle · 0071 MCP server
tables · 0072 MCP consumed authorization codes · 0073 drop
`profiles.ai_opted_in` · 0074 `cardio_logs` finish-uniqueness ·
0075 `strava_event_log` · 0076 `strava_event_log` payload columns.

---

### Added — Phase 1 starting point: movement catalog (commit pending)

- **0002_movement_metadata migration** applied live to Supabase: 22-value `muscle` enum (DC-T1 priorities), `axial_load` enum (DC-D3), `stability` enum (DC-O5), 7 new columns on `movements` (`primary_muscles`, `secondary_muscles`, `high_strain_tendon`, `axial_load`, `stability`, `bilateral`, `body_weight_loaded`). GIN indexes on muscle arrays for the aesthetics dashboard.
- **`packages/db/seeds/`**: 275-movement seed catalog organised into 3 files (strength patterns / isolation / cardio+plyo+olympic+tendon+cuff+drills), with category-helper builders for terse per-movement overrides. Includes 28 squat, 24 hinge, 24 press, 25 pull, 6 carry, 87 isolation, 38 cardio (cycling/running/rowing/sled/ruck/swim/etc.), 12 plyometric, 8 Olympic, 9 tendon-resilience (Baar isometric / Kongsgaard HSR / Alfredson eccentric protocols), 8 rotator-cuff, 6 run drills, 6 grip. 42 flagged `high_strain_tendon` for DC-J5 6h refractory.
- **Seed runner** (`pnpm --filter @hta/db db:seed`): idempotent upsert via `ON CONFLICT (user_id, slug) DO UPDATE`, with pre-flight sanity checks (no duplicate slugs, every non-carry movement has ≥ 1 primary muscle) and post-seed `\dt`-style verification by pattern.
- **Seed-shape Vitest suite** (`seeds/movements.test.ts`): 24/24 pass — uniqueness, region coverage, primary-muscle coverage per priority (every DC-T1 muscle has ≥ 3 movements), Olympic-implies-compound, cardio-has-interference-cost.

### Phase 0 → Phase 1 transition
Phase 0 closed (live at https://hybrid-training-app-web.vercel.app). Phase 1 movement-catalog foundation now in place. Next: `sessions` + `set_logs` + `cardio_logs` + `wellness` tables + the logging UI.
