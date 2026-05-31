/**
 * Embedded reference knowledge — surfaced to the LLM inside every
 * `EngineSnapshot`. ADR 0002 § "Snapshot tiering": curated knowledge
 * is shipped *in-prompt* rather than retrieved (no RAG in v1).
 *
 * Three blocks:
 *   - `ARCHETYPES_SUMMARY`   — one-line description per archetype.
 *   - `CALIBRATION_POLICY_TEXT` — CP-1..CP-5, the calibration discipline
 *     that the engine + AI layer share. Hardcoded text (not round-tripped
 *     to docs/knowledge/hybrid-training-design-constraints.md) per ADR 0002
 *     "Hardcoded text is fine; this doesn't have to round-trip to the
 *     workspace doc."
 *   - `CONSTANTS_TABLE_TEXT` — CP-2 constants table (the small finite
 *     catalogue of engine coefficients the AI cites when explaining).
 *
 * Hard budget: under 5k tokens combined (DC-Q1 plain-language, brand-pure).
 */

import { ARCHETYPES, type Archetype } from "@/lib/planner/archetypes";

export type ArchetypeSummary = {
  id: string;
  name: string;
  description: string;
};

const ARCHETYPE_DESCRIPTIONS: Record<string, string> = {
  strength_anchor:
    "Anchored on heavy compound lifts; cardio runs as a supporting modality. Bias: build strength while preserving aerobic base.",
  endurance_anchor:
    "Anchored on Z2 + threshold + intervals; strength runs as a supporting modality. Bias: build engine while preserving strength floor.",
  rebuild:
    "Capped intensity, single sessions, low-CNS-load lifts and Z2 cardio. Used after deload, illness, or extended layoff.",
  hypertrophy_anchor:
    "Volume-led strength block; accessories on by default; rep ranges in the 6–12 zone. Bias: build muscle.",
  concurrent_hybrid:
    "Balanced strength + cardio with explicit interference accounting. Bias: hold both fitnesses at once with structured pacing.",
  maintenance:
    "Minimum effective dose across strength and cardio. Used when life capacity is reduced; preserves current fitness without growth.",
};

export const ARCHETYPES_SUMMARY: ArchetypeSummary[] = (
  Object.values(ARCHETYPES) as Archetype[]
).map((a) => ({
  id: a.id,
  name: a.name,
  description: ARCHETYPE_DESCRIPTIONS[a.id] ?? a.oneLiner ?? "",
}));

/**
 * CP-1..CP-5 — calibration policy. The discipline by which all engine
 * defaults are derived, tunable, and bounded. The AI cites these when
 * the user asks "why is the engine doing X?".
 */
export const CALIBRATION_POLICY_TEXT = `
CP-1 — Evidence first, defaults second.
  Every engine coefficient is one of three things: an evidence-informed
  principle (EV) that load-bears the design, an engineering default (DEF)
  that is overridable, or a default-pending-calibration (DEF→cal) that
  the engine will tune as user data accumulates. The AI must respect this
  hierarchy when explaining: EV is "this is how training works", DEF is
  "this is our current best setting", DEF→cal is "this will move as the
  engine learns about you."

CP-2 — Constants live in a single table.
  Every numeric coefficient the engine consumes (ATL/CTL decay rates,
  bucket ceiling caps, confidence-bias slope,
  etc.) is read from a typed constants table — never hardcoded inline.
  See CONSTANTS_TABLE_TEXT below for the v1 catalogue. The AI cites
  table rows by name; it does NOT invent new constants in conversation.

CP-3 — Heuristic-pending-data discipline.
  When the data window is insufficient to compute a coefficient (cold
  start, post-layoff, sparse session history), the engine substitutes
  a documented heuristic and marks the output as low-confidence. The AI
  surfaces this caveat to the user: "the engine is using a default here
  because it doesn't have enough recent data."

CP-4 — Two-factor ceiling chain.
  Weekly ceiling = baseCeiling × confidenceBias.
  - baseCeiling: median weekly tonnage across the last 3 recovered weeks
    (DC-K1).
  - confidenceBias: penalty applied when data completeness is low; in
    [0.85, 1.00] (DC-K2).
  No new multipliers may be introduced without an ADR. The AI explains
  ceiling decisions by walking this chain in order.

CP-5 — Override-and-warn transparency.
  When the user overrides an engine-derived default, the engine records
  the override, surfaces the warning text including the cited rule, and
  proceeds with the user's choice. The AI never silently follows an
  override: it names the rule that fired and notes the override.
`.trim();

/**
 * CP-2 constants table. Compact, finite, brand-pure (no external
 * program names). Verbatim from the calibration-policy doc.
 */
export const CONSTANTS_TABLE_TEXT = `
| Constant                     | Value      | Where used                                                     |
|------------------------------|------------|----------------------------------------------------------------|
| ATL decay (acute, days)      | 7          | Acute training load, per-region and per-bucket EWMA half-life. |
| CTL decay (chronic, days)    | 28         | Chronic training load, per-region and per-bucket EWMA.         |
| Confidence-bias floor        | 0.85       | DC-K2 — applied at <60% data completeness.                     |
| Confidence-bias ceiling      | 1.00       | DC-K2 — applied at ≥90% data completeness.                     |
| Ceiling base lookback        | 12 weeks   | DC-K1 — window for "last 3 recovered weeks" median.            |
| Recovered-week threshold     | GRM ≥ 0.95 | DC-K1 — what counts as a recovered week.                       |
| Region freshness bands       | 5          | fresh / ready / lingering / recovering / heavily-loaded.       |
| Fresh band threshold         | freshness ≥ 0.85 | DC-V1 — soft-warn budget intact, no caveats.             |
| Recovering band threshold    | freshness ≥ 0.10 | DC-V2 — soft-warn before scheduling heavy work.          |
| Heavy-on-recovering trigger  | warn       | DC-V2 — Gabbett 2016 acute-to-chronic injury-risk curve.       |
| Bucket count                 | 6          | neural, mechanical, metabolic, impact, axial, tissue.          |
| Bucket pressure window       | 7 / 28 d   | Acute EWMA / chronic norm pair.                                |
| Interference modifier        | 0.70       | OC-16 DEF→cal — applied to MAV/MRV at ≥4h/wk cardio.           |
| Concurrent gap (h)           | 6          | DC-D1 — minimum gap between same-day lift and hard cardio.     |
| Calibration cadence          | 4 weeks    | DC-K3 — engine re-fits coefficients no more often than this.   |
| Compaction trigger           | 32k tokens | ADR 0002 — chat history compaction (deferred from v1).         |
| Max tool calls per turn      | 6          | ADR 0002 retry / tool-call limits.                             |
| Max validation retries       | 2          | ADR 0002 retry / tool-call limits.                             |
| Snapshot daily window        | 90 days    | ADR 0002 snapshot tiering — daily resolution.                  |
| Snapshot weekly window       | 90 d–1 y   | ADR 0002 snapshot tiering — weekly aggregates.                 |
| Snapshot monthly window      | > 1 year   | ADR 0002 snapshot tiering — monthly aggregates.                |
| PR timeline window           | all-time   | ADR 0002 snapshot tiering — finite, valuable for "best ever".  |
`.trim();
