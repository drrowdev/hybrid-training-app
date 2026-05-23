# AI Roadmap — Wendler-Port Deferred Items

**Purpose:** Captures features audited from the user's older Wendler 5/3/1 app (red-moss-02386a803.7.azurestaticapps.net) that we elected to **defer** rather than build in the current Today-page → command-palette → stats wave. Each item lists rationale, the current Hybrid-app gap, a UX sketch, and dependencies so a future planning session can lift it straight into a PR brief.

**Created:** 2026-05-23 (after the cross-app audit in chat session `2d49dc63-b811-4838-ae33-d0dece44a44b`)
**Wave context:** of the 18-item porting candidate list, items #1, #2, #4, #5, #6, #7, #17, #18 were lifted into the active build queue; items below were parked here.

---

## #9 — `/races` dedicated page

**Rationale.** The hybrid engine already understands priority events (`priority_events` table, taper recommendation logic in `lib/planner/taper.ts`) but has no first-class UI for managing them. Wendler exposes a `/races` route with calendar, A/B/C priority, taper status, and post-event results — the data model on our side is richer (multi-modality), so the UX needs to handle non-running events too.

**Current gap.**
- Priority events are read on the Today page (taper card) and presumably from `/app/plan`, but the user can't list, edit, or delete them in one place.
- No post-event results capture.

**UX sketch.**
- Route: `/app/races` (or `/app/events` if we keep multi-modality terminology — TBD).
- Top: timeline strip showing the next 12 months with event markers.
- List view below: each event with name · date · priority (A/B/C) · status (upcoming / tapering / completed) · result (collapsed by default).
- New-event modal: name, date, priority, modality, notes, target performance.
- Per-event detail: taper plan auto-derived, post-event "How did it go?" capture with result fields per modality (run: time/distance/pace; lift: total/PRs; padel: rank/notes).

**Dependencies.** None blocking — `priority_events` schema may need a `result` JSONB column and a `modality` enum.

---

## #10 — `/injuries` dedicated page

**Rationale.** The engine already applies injury-aware ceilings (DC-V series in design-constraints.md, active-limitations contract). The data lives in `active_limitations` but there's no UI for the user to add, edit, deactivate, or browse history.

**Current gap.**
- User can't self-serve limitations — they have to be set via DB or admin.
- No history view of resolved limitations.
- No Coach-proposed-adjustment UI surface.

**UX sketch.**
- Route: `/app/recovery/injuries` (mirrors Wendler).
- Top: "Active limitations" list with severity badge, affected region(s)/movement(s), reason, start date, "End" button.
- Below: "History" collapsed by default — past limitations with start/end dates.
- Add-limitation form: region picker (using the 16-muscle grid from PR #44 once shipped), severity (mild/moderate/severe), affected movement list, free-text notes, expected duration.
- Sidebar: "Coach proposed adjustments" — what the engine has done in response (e.g., "Squat capped at 60% TM until knee-flag is cleared").

**Dependencies.**
- Should land after the 16-muscle grid PR (muscle-aware limitations are much richer than region-aware).
- Engine query layer already returns active limitations; UI is the missing piece.

---

## #11 — Training Profile page

**Rationale.** Currently the user's "profile" data (display name, timezone, AM/PM windows, bodyweight, movement focus, archetype preference, AI notes) is scattered across `/app/settings`, the onboarding flow, and various card-level surfaces. Wendler centralises it on a focused profile page.

**Current gap.**
- No single place to see "who am I as a trainee" — movement focus, current phase, AI notes about your patterns, recent bodyweight trend.
- Bodyweight history is only the nudge card on `/app`.

**UX sketch.**
- Route: `/app/profile`.
- Header: display name + initials + recent bodyweight chart (last 90 d sparkline).
- Sections:
  - Movement focus: which lifts the user prioritises (read from `training_maxes` + recent session frequency).
  - Phase: active block + archetype + week.
  - AI notes: a free-text field the engine writes to (e.g., "Tends to under-recover from heavy deadlift days"), user-editable.
  - Preferences: AM/PM windows, timezone, units (kg/lb), language.
- Move bodyweight + check-in history here from the wellness page (or cross-link).

**Dependencies.** None.

---

## #12 — Calendar view modes + filters + legend

**Rationale.** Wendler's calendar has month-grid AND timeline views with strength/cardio filters and a colour legend. Ours (`/app/plan`) shows a list.

**Current gap.**
- No month-grid view — hard to see "what did I do this month?"
- No filter toggle for strength-only vs cardio-only.
- No legend explaining the colour scheme.

**UX sketch.**
- Tabs: Month · Timeline · List.
- Filter chips: All · Strength · Cardio (multi-select).
- Legend below: Strength done · Strength planned · Cardio done · Cardio planned · Past unfulfilled (tap to link to Strava session) · Strava badge.
- Tapping a past unfulfilled day opens a "Did this happen?" modal with quick-log + Strava-match options.

**Dependencies.**
- Calendar heatmap PR (in current wave) lays groundwork but this is a separate, more interactive view.

---

## #13 — Phase auto-shift on race calendar

**Rationale.** When an A-race is N days out, the engine should auto-shift the active block's archetype (e.g., from Hypertrophy Anchor → Peak/Taper). Wendler does this and surfaces it as a notification ("Phase auto-shifted to peak (B-race in 19 days)") with Accept/Dismiss.

**Current gap.**
- Taper card on `/app` is read-only — no action surface.
- No notion of "auto-shift the block archetype" in the planner.

**UX sketch.**
- Engine layer: extend the planner to detect "A-race within taper window" and propose an archetype transition.
- Notification: "Phase auto-shifted to peak. B-race in 19 days." with two buttons: Accept (applies the shift) · Dismiss (engine logs the dismissal and won't propose again for 7 days).
- The Today taper card grows a second action: "Apply peak shift now".

**Dependencies.**
- Notifications inbox (#3 — not in current wave; the user may want to add it).
- Requires extending the planner with an archetype-transition recommendation.

---

## #14 — "What is this?" inline help (i icons) on metrics

**Rationale.** Wendler puts a small `i` icon next to every load metric (CTL, ATL, TSB, ACWR, freshness, etc.) that opens a short explanation on hover/tap. Lowers the explanation burden the engine-page documentation otherwise carries.

**Current gap.**
- Some metrics on `/app/stats/engine` already have help-text via `<span className="cp-info">` (used on the Rest day card for "Why a rest day?"). Pattern exists but isn't applied consistently.

**UX sketch.**
- Audit all stats cards and engine surfaces.
- Anywhere a derived/computed number appears (freshness %, bucket pressure, ceiling kg, ACWR, MV/MEV/MAV/MRV, taper days, etc.), append a `cp-info` icon with a 2–3 line plain-language explanation.
- Build a small `<MetricHelp term="...">` component that pulls from a central glossary (one source of truth: `lib/glossary.ts`).

**Dependencies.** None blocking.

---

## #15 — AMRAP → e1RM vs entered 1RM distinction

**Rationale.** Wendler clearly distinguishes between an estimated 1RM (from an AMRAP top set, via Epley or Brzycki) and an entered 1RM (user-typed). The hybrid app probably has e1RM math (check `lib/training-maxes/`) but the UI doesn't surface the difference.

**Current gap.**
- TMs page shows one number — the user can't tell if it came from a recent AMRAP or a manual entry.
- The Today hero's top-set chip doesn't say "based on e1RM 145kg (from AMRAP last Wed)" vs "based on entered 1RM 150kg".

**UX sketch.**
- TM row grows a small badge: `(e1RM)` if derived, `(entered)` if manual.
- Hover/tap shows: source set (date + weight × reps), formula used (Epley/Brzycki), and a "Lock as entered 1RM" action.
- Today hero subtitle: "Top set 102 kg × 5 · based on e1RM (last AMRAP 2 weeks ago)".

**Dependencies.** Need to read `lib/training-maxes/queries.ts` to see what's stored — if only the rounded value is in `training_maxes`, we need a `source` enum and a `derived_from_session_id` FK.

---

## #16 — TAPER auto-detection with Accept/Dismiss

**Rationale.** Hybrid already computes a taper recommendation (`lib/planner/taper.ts`, surfaced as the Today TaperCard). Wendler takes it one step further: it auto-detects taper conditions AND proposes specific actions (Insert deload, Activate competition peaking goal flag) with Accept/Dismiss buttons.

**Current gap.**
- Taper card is informational — no actionable buttons.
- No "Insert deload now" or "Activate peaking" actions.

**UX sketch.**
- TaperCard grows two action buttons:
  - "Insert deload week" — clones next week's plan at -20% volume and shifts subsequent weeks.
  - "Activate peaking" — pins archetype = Peak/Taper until the event date.
- Each action is recorded in the override audit log with the AI rationale.

**Dependencies.**
- Phase auto-shift (#13) overlaps heavily; build them together.
- Override audit log is already in (PR #38).

---

## Build-order recommendation

When this list is next worked, suggested wave:

1. **#15 AMRAP → e1RM distinction** — small, mostly local to TM display, no upstream dependencies. Good warm-up.
2. **#14 "What is this?" pattern + glossary** — also small, infrastructural; everything else benefits.
3. **#10 `/injuries` page** — requires the 16-muscle grid (in the current wave) to be merged first.
4. **#11 Training Profile page** — moderate, no blockers.
5. **#9 `/races` page** — moderate.
6. **#12 Calendar view modes** — larger, depends on `/races` for event linkage.
7. **#16 TAPER auto-detection** — depends on the notifications inbox (out of scope this wave) for the Accept/Dismiss UX. Build the action buttons first, defer the notification thread.
8. **#13 Phase auto-shift** — bundle with #16 because both ride the same archetype-transition recommendation in the planner.

---

## Related (not on the deferred list, but mentioned in the audit)

The user explicitly skipped these from the active wave but didn't add them here either — they may be revisited:

- **#3 Notifications inbox with AI rationales** — categorical filters (AI action / Phase auto-shift / Sync), per-item rationales. Hybrid has the data (override audit log) but no inbox UI. Likely belongs here once #13/#16 land, since both ride on it.
- **#8 Auto-generated daily training brief** — "Your training brief for [date]" linking to a fuller summary. Couples to #3.

If these get added, drop them in above #13/#16 and rewire the build order.

---

*Maintained per the Karpathy pattern (plan §6.10). Update the index and append to the log when this file changes.*
