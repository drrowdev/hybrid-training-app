# AI Roadmap — Deferred UX & Feature Items

**Purpose:** Captures UX and feature items that we elected to **defer** rather than build in the current Today-page → command-palette → stats wave. Each item lists rationale, the current app gap, a UX sketch, and dependencies so a future planning session can lift it straight into a PR brief.

**Created:** 2026-05-23 (after a UX audit pass)
**Wave context:** of an 18-item candidate list, items #1, #2, #4, #5, #6, #7, #17, #18 were lifted into the active build queue; items below were parked here.

**2026-05-30 audit update.** Most of the originally-deferred items have since shipped. See the **"Closed — shipped"** section at the bottom. The roadmap itself is overdue a full re-write; until that happens, treat the per-item sections below as historical context for what shipped, not as the current backlog. Outstanding items as of 2026-05-30: **#13 Phase auto-shift** and **#16 TAPER auto-detection** (both ride on a notifications inbox that doesn't exist yet).

---

## #9 — `/races` dedicated page

**Rationale.** The engine already understands priority events (`priority_events` table, taper recommendation logic in `lib/planner/taper.ts`) but has no first-class UI for managing them. A dedicated `/races` route would centralise calendar, A/B/C priority, taper status, and post-event results. The data model is multi-modality, so the UX needs to handle non-running events too.

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
- Route: `/app/recovery/injuries`.
- Top: "Active limitations" list with severity badge, affected region(s)/movement(s), reason, start date, "End" button.
- Below: "History" collapsed by default — past limitations with start/end dates.
- Add-limitation form: region picker (using the 16-muscle grid from PR #44 once shipped), severity (mild/moderate/severe), affected movement list, free-text notes, expected duration.
- Sidebar: "Coach proposed adjustments" — what the engine has done in response (e.g., "Squat capped at 60% TM until knee-flag is cleared").

**Dependencies.**
- Should land after the 16-muscle grid PR (muscle-aware limitations are much richer than region-aware).
- Engine query layer already returns active limitations; UI is the missing piece.

---

## #11 — Training Profile page

**Rationale.** Currently the user's "profile" data (display name, timezone, AM/PM windows, bodyweight, movement focus, archetype preference, AI notes) is scattered across `/app/settings`, the onboarding flow, and various card-level surfaces. A focused profile page would centralise it.

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

**Rationale.** A month-grid + timeline view of training (with strength/cardio filters and a colour legend) makes "what did I do this month?" answerable at a glance. The current `/app/plan` only shows a list.

**Current gap.**
- No month-grid view — hard to see "what did I do this month?"
- No filter toggle for strength-only vs cardio-only.
- No legend explaining the colour scheme.

**UX sketch.**
- Tabs: Month · Timeline · List.
- Filter chips: All · Strength · Cardio (multi-select).
- Legend below: Strength done · Strength planned · Cardio done · Cardio planned · Past unfulfilled (tap to link to a logged session). *(The Strava badge is gone — integration removed 2026-08-17.)*
- Tapping a past unfulfilled day opens a "Did this happen?" modal with quick-log + link-a-logged-activity options.

**Dependencies.**
- Calendar heatmap PR (in current wave) lays groundwork but this is a separate, more interactive view.

---

## #13 — Phase auto-shift on race calendar

**Rationale.** When an A-race is N days out, the engine should auto-shift the active block's archetype (e.g., from Hypertrophy Anchor → Peak/Taper) and surface it as a notification ("Phase auto-shifted to peak (B-race in 19 days)") with Accept/Dismiss.

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

**Rationale.** A small `i` icon next to every load metric (CTL, ATL, TSB, ACWR, freshness, etc.) that opens a short explanation on hover/tap lowers the explanation burden the engine-page documentation otherwise carries.

**Current gap.**
- Some metrics on `/app/stats/engine` already have help-text via `<span className="cp-info">` (used on the Rest day card for "Why a rest day?"). Pattern exists but isn't applied consistently.

**UX sketch.**
- Audit all stats cards and engine surfaces.
- Anywhere a derived/computed number appears (freshness %, bucket pressure, ceiling kg, ACWR, MV/MEV/MAV/MRV, taper days, etc.), append a `cp-info` icon with a 2–3 line plain-language explanation.
- Build a small `<MetricHelp term="...">` component that pulls from a central glossary (one source of truth: `lib/glossary.ts`).

**Dependencies.** None blocking.

---

## #15 — AMRAP → e1RM vs entered 1RM distinction

**Rationale.** An estimated 1RM (from an AMRAP top set, via Epley or Brzycki) is a different number than an entered 1RM (user-typed). The app probably has e1RM math (check `lib/training-maxes/`) but the UI doesn't surface the difference.

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

**Rationale.** The app already computes a taper recommendation (`lib/planner/taper.ts`, surfaced as the Today TaperCard). One step further: auto-detect taper conditions AND propose specific actions (Insert deload, Activate competition peaking goal flag) with Accept/Dismiss buttons.

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

---

## #7 — AI chat surface (FAB + conversation backend) — **shipped 2026-05-28 via ADR 0002 + 0003**

**Status: shipped.** Replaced by the dual-path implementation laid out
in [`docs/adr/0002-ai-architecture.md`](../adr/0002-ai-architecture.md)
(Explain v1 + BYOAI) and
[`docs/adr/0003-mcp-dual-path.md`](../adr/0003-mcp-dual-path.md) (MCP
server + in-app chat through a shared 8-tool catalogue). The eight open
questions below were resolved in those ADRs; the original deferral
rationale is preserved here for lineage.

- **Backend model:** BYOAI — pluggable `LlmProvider` for Anthropic /
  OpenAI / Gemini; user supplies their own key, stored in a pgcrypto
  vault keyed by `AI_KEY_ENCRYPTION_KEY`.
- **Conversation persistence:** per-thread, Supabase-backed.
- **Grounding:** tool-calling against an 8-tool catalogue
  (`getEngineSnapshot` and friends) shared with the MCP server.
- **Allowed actions:** read-only in v1.
- **Privacy:** keys never leave the server vault; tool calls scoped to
  the calling `user_id`.
- **Voice:** plain-language, brand-pure (DC-Q1, DC-Q6).
- **Fallback:** chat is opt-in per provider; absent a configured key
  the FAB tells the user how to add one.
- **Quality bar:** eval fixtures shipped alongside `getEngineSnapshot`
  in PR #187; observability scaffolding in PR #186.

### Original deferral rationale (historical)

**Why this was deferred.** Anything AI-touching needs its own planning pass — model selection, prompting strategy, conversation persistence, privacy posture, and rate-limit / cost model are decisions that shouldn't be made in passing as a UI affordance. A floating button is the easy part; the hard part is the engine behind it.

**The original ask.** A floating action button bottom-right on every `/app/*` page that opens a chat surface where the user can ask the engine questions ("Why is this week deload?", "Why did you reduce Tuesday's squat top set?", "Suggest accessories for tomorrow"). The engine already has reasoning surface area — override audit log, region freshness, ceiling explainers, tier-detection contributors — that a chat layer could expose conversationally.

**Open questions to resolve before building (none of these have answers yet):**

1. **Backend model.** Local LLM (Ollama / llama.cpp) vs hosted API (OpenAI / Anthropic / Azure OpenAI)? If hosted, who pays for tokens? Per-user quota? Bring-your-own-key?
2. **Conversation persistence.** Is each chat a fresh session, or do conversations persist? If persistent, where (Supabase row per turn? per thread?) and with what retention?
3. **Grounding strategy.** Retrieval over the user's training history + engine state, or stateless prompts? If retrieval, what's in the context window? Tool-calling for engine queries vs pre-fetched bundle?
4. **Allowed actions.** Read-only (answer questions only) or write-capable (propose-and-apply overrides, log adjustments)? Write-capable opens up DC-K4-style override-and-warn semantics in chat.
5. **Privacy.** Engine reasoning may include health-adjacent context (fatigue, soreness, injuries). What data goes to the model, what stays local, what's redacted?
6. **Voice / persona.** Coaching tone? Plain-language only (DC-Q1)? Brand-purity (DC-Q6) — same rule applies: no external program names ever.
7. **Fallback when unavailable.** When the AI backend is down, slow, or rate-limited — how does the UI degrade? Pre-canned answers for common queries? Just hide the FAB?
8. **Quality bar before launch.** How do we know the answers are good enough to ship? Eval set? Spot checks by the project owner? Beta-flag for a single user (the dev) first?

**Suggested next step.** Open a planning session purely on AI surface area. Produce a small ADR-style doc covering points 1–8 above, then break the implementation into a sequenced PR plan. Until that planning lands, the UI surface stays unbuilt.

**Provisional UX (not committed).** If the FAB is greenlit later:
- Floating button, bottom-right, ~56px circle, accent fill with chat icon.
- Click opens a sheet from the right (desktop) or bottom (mobile), 480px wide max.
- Header: "Ask the coach" (or whatever name; brand-pure copy).
- Body: scrollable message list, input at bottom with Send.
- Optional: surface a "Why did the engine do X?" deep-link from override audit cards to start a pre-seeded conversation.

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
9. **#7 AI chat surface** — gated on its own planning ADR (see section above). Do not start until the 8 open questions have written answers.

---

## Related (not on the deferred list, but mentioned in the audit)

The user explicitly skipped these from the active wave but didn't add them here either — they may be revisited:

- **#3 Notifications inbox with AI rationales** — categorical filters (AI action / Phase auto-shift / Sync), per-item rationales. Hybrid has the data (override audit log) but no inbox UI. Likely belongs here once #13/#16 land, since both ride on it.
- **#8 Auto-generated daily training brief** — "Your training brief for [date]" linking to a fuller summary. Couples to #3.

If these get added, drop them in above #13/#16 and rewire the build order.

---

## Closed — moved to active wave

### #18 — `EmptyState` primitive + audit pass (shipped 2026-05-24)

**What landed.** New shared component `apps/web/src/components/ui/EmptyState.tsx` with two variants (`card` full-card replacement; `inline` compact in-card). Every empty branch now follows the "explain what unlocks this card" voice: a one-sentence body telling the user the answer + action + reason. Applied to:

- Today page — "Up next this week" + "Recent activity" + Goals rail card.
- Stats overview (`/app/stats`) — current block strip, adherence card, PRs card, region freshness card, volume card, bodyweight trend card.
- Stats wellness (`/app/stats/wellness`) — bodyweight, fatigue, soreness, motivation, prediction-accuracy cards (preserves e2e text anchors).
- Stats engine (`/app/stats/engine`) — region freshness, bucket pressure, recent overrides.
- Stats blocks index + detail — empty blocks list, no main lifts logged, no RPE creep data.
- `/app/freshness` — explainer inline under the grey-state grid.
- `/app/sessions` — empty sessions list.

**Pattern from here on.** Any new card whose data can be missing should reach for `<EmptyState>` rather than ad-hoc microcopy. Use `card` for full-card empties and `inline` when sitting inside an existing `cp-card` body. Copy voice: short, no exclamation marks, second person, prescriptive — "Log your…", "…populate this card."

Stats adherence is intentionally not in scope here; its empty-state pass is owned by #17 (run-plan adherence card).


*Maintained per the Karpathy pattern (plan §6.10). Update the index and append to the log when this file changes.*

## Open follow-ups

### Bodyweight progression engine
Proper push-up / pull-up / squat progression ladders with rep-based "training max" equivalents (e.g. `5 strict pull-ups` is a 1RM-equivalent that should drive band-assisted / weighted-vest progression). Currently bodyweight-only blocks fall back to accessories-only with RPE intensity ÔÇö the `BodyweightOnlyBanner` flags this as early support. Scope when picked up: a parallel main-lift slot for bodyweight movements, a rep-floor / rep-ceiling progression mechanic, and weighted-vest / dip-belt / band-assist tooling that the picker already understands.

---

## Closed — shipped

2026-05-30 audit. Items lifted out of the parking lot:

- **#9 /races page** — shipped 2026-05-23 as `/app/races` (PR #56). Route retired 2026-08-18: the surface now lives at `/app/settings/events`, which absorbed the richer implementation and replaced the plain form that was there.
- **#10 /injuries page** — shipped 2026-05-23 as `/app/recovery/injuries` (PR #54). Further extended by Limitations v2 lifecycle in PR #189 (bilateral side + muscle-level filter + per-exercise allow + event lifecycle + Today banner). Migration 0070.
- **#11 Training Profile page** — shipped 2026-05-23 as `/app/profile` (PR #55). Route retired 2026-08-18 as an unlinked duplicate of `/app/settings/profile`; its two unique settings (training notes, AM/PM training windows) moved there.
- **#12 Calendar view modes** — shipped 2026-05-23 (PR #57: Month / Timeline / List with filters + legend). Further redesigned in the /plan layout shift (PRs #133, #200-#205) with scrollable calendar + drawer drill-down + filter persistence via `?filter=`.
- **#14 'What is this?' inline help** — shipped 2026-05-23 as the `MetricHelp` primitive with central glossary (PR #53).
- **#15 AMRAP -> e1RM distinction** — shipped 2026-05-23 (PR #52: AMRAP-driven e1RM vs entered 1RM distinction + suggestion banner). Anchor PR detection now binds to saved 1RM rather than historical max (PR #75).
- **#18 EmptyState primitive** — shipped 2026-05-24 (see top of file).
- **#7 AI chat surface** — shipped 2026-05-28 via ADR 0002 (Explain v1 + BYOAI) and ADR 0003 (MCP dual path). See the #7 section above for the resolved open-questions trail.

## Still open

- **#13 Phase auto-shift on race calendar** — unchanged. Still gated on a notifications inbox UI.
- **#16 TAPER auto-detection with Accept/Dismiss** — unchanged. Bundle with #13.
- **Open follow-up: Notifications inbox** — referenced in `Related` above. Needs its own design pass before #13 / #16 can land their Accept/Dismiss UX.
