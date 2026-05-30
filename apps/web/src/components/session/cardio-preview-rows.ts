/**
 * Pure helper that turns a cardio `PrescriptionItem` into an ordered
 * list of labeled rows (Duration / Intervals / Intensity / Recovery /
 * Protocol) for the read-only Session Preview card.
 *
 * Parsing limitation: `protocolNote` is free-text and varies by
 * archetype (e.g. "4 × 4 min @ 90–95% HRmax, 3 min easy recovery" vs
 * "6–10 × 10–15s near-max hill sprints, walk back down for recovery
 * (~90–120s)"). We pattern-match common shapes (sets × duration, "@
 * intensity", "recovery"/"easy spin"/"walk back") to produce labeled
 * rows. Anything we can't recognise is grouped under a generic
 * "Protocol" row rather than being dropped — the goal is "always more
 * readable than the original single-line mash", not perfect parsing.
 */
import type { PrescriptionItem } from "@hta/db";

export type CardioRow = { label: string; value: string };

/**
 * Last-resort Intensity copy keyed by cardio kind. Used when neither
 * `protocolNote` parsing nor `hrCap` produced an Intensity row, so the
 * hero card and the Preview page never end up with a cardio block that
 * shows zero intensity guidance (the Z2 hero card bug that motivated
 * this fallback — `hrCap` was the only signal and parser-style cardio
 * sessions had no fallback at all).
 *
 * NOTE: some movement-specific cases — e.g. bike sprints expressed as
 * power zones rather than HR — could justify a richer per-movement
 * override. Out of scope here; revisit when the engine grows power-
 * zone prescriptions. TODO(cardio-intensity): per-modality overrides.
 */
const KIND_INTENSITY_FALLBACK: Record<string, string> = {
  cardio_z2: "≤ 70% HRR (conversational)",
  cardio_threshold: "~85–88% HRmax (just below threshold)",
  cardio_vo2: "90–95% HRmax (hard)",
  cardio_alactic: "Near-max effort (>95% HRmax)",
};

const GENERIC_INTENSITY_FALLBACK = "Follow prescribed effort";

export function cardioPreviewRows(item: PrescriptionItem): CardioRow[] {
  const rows: CardioRow[] = [];

  if (item.durationMin != null) {
    rows.push({ label: "Duration", value: `${item.durationMin} min` });
  }

  const note = item.protocolNote?.trim();
  let intensityFromNote = false;

  if (note) {
    const segments = note.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
    const remaining: string[] = [];
    let consumedIntervals = false;
    let consumedRecovery = false;

    for (const seg of segments) {
      // Recovery / easy spin / walk-back patterns.
      if (
        !consumedRecovery &&
        /\brecovery\b|easy spin|walk[- ]back/i.test(seg)
      ) {
        rows.push({
          label: "Recovery",
          value: seg.replace(/^with\s+/i, "").replace(/\s+between intervals$/i, ""),
        });
        consumedRecovery = true;
        continue;
      }

      // First segment with "N × M unit @ intensity" → split into
      // Intervals + Intensity rows.
      const at = seg.match(/^(.+?)\s*@\s*(.+)$/);
      if (!consumedIntervals && at && /[×x]/.test(at[1]!)) {
        rows.push({ label: "Intervals", value: at[1]!.trim() });
        rows.push({ label: "Intensity", value: at[2]!.trim() });
        intensityFromNote = true;
        consumedIntervals = true;
        continue;
      }

      if (!consumedIntervals && /[×x]/.test(seg)) {
        rows.push({ label: "Intervals", value: seg });
        consumedIntervals = true;
        continue;
      }

      remaining.push(seg);
    }

    if (remaining.length > 0) {
      rows.push({ label: "Protocol", value: remaining.join(", ") });
    }
  }

  // We deliberately do NOT emit a dedicated "HR cap" row anymore: when
  // both an Intensity (parsed from protocolNote) and an hrCap exist they
  // are nearly always restating the same target (e.g. "90–95% HRmax" vs
  // "90–95% HRmax during work"), and the duplicate row was pure noise.
  // Falling back to using hrCap AS the Intensity row when the note
  // didn't produce one keeps Z2-style sessions (hrCap only, no
  // protocolNote) from losing their only intensity signal.
  if (item.hrCap && !intensityFromNote) {
    rows.push({ label: "Intensity", value: item.hrCap });
  }

  // Final fallback: every cardio item must surface SOME intensity
  // guidance so downstream surfaces (Today hero, Preview page) render
  // a consistent structure regardless of how sparse the prescription
  // is. Z2 sessions tend to have hrCap; other kinds may have neither
  // protocolNote nor hrCap — give them a kind-based default.
  if (!rows.some((r) => r.label === "Intensity")) {
    const fallback =
      (item.kind && KIND_INTENSITY_FALLBACK[item.kind]) ??
      GENERIC_INTENSITY_FALLBACK;
    rows.push({ label: "Intensity", value: fallback });
  }

  return rows;
}
