"use client";

/**
 * HYROX structured-session completion form (ADR 0050 step 7c).
 *
 * Renders the prescribed structure of a HYROX run/erg/interval/circuit/compromised/
 * simulation, lets the athlete confirm the loaded-station weights, enter one total
 * time + one session RPE, and complete — materializing the prescription into actual
 * log rows via `completeHyroxSession`. When a Strava activity is already linked, an
 * orange banner offers to fill the time + intensity (enrich, never auto-complete);
 * otherwise a manual "import from Strava" action triggers a session sync.
 *
 * Matches the approved mock (hyrox-completion-mock): structured list, confirm-weight
 * inputs for loaded stations only, time + RPE, Strava-orange linked banner XOR the
 * manual import button.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeHyroxSession } from "@/lib/hyrox/complete-action";
import { syncStravaForSession, type StravaSessionCandidate } from "@/lib/integrations/strava/actions";
import { CardioPlanView, type CardioPlanShape } from "@/components/session/CardioPlanView";

export interface HyroxStructureRow {
  /** Step label, e.g. "Run" / "Sled Push" / "Round 1". */
  name: string;
  /** Secondary detail, e.g. "1 km" / "Open · incl. sled · 50 m". */
  detail?: string;
  /** Right-aligned amount, e.g. "1 km" / "100 reps". */
  amount?: string;
}

export interface HyroxLoadedStation {
  /** Engine station key (the confirmedWeights map key). */
  key: string;
  name: string;
  /** Prefilled default (division standard, kg). */
  defaultKg: number;
  /** Helper line, e.g. "Open: M 152 kg / W 102 kg — confirm yours". */
  loadLabel: string;
  amount?: string;
}

export interface HyroxStravaMatch {
  durationSec: number;
  avgHrBpm: number | null;
  /** Short summary, e.g. "Strava activity found · 1:08:12". */
  label: string;
}

export interface HyroxCompletionFormProps {
  sessionId: string;
  title: string;
  weekLabel?: string;
  structure: HyroxStructureRow[];
  /**
   * The materialized cardio plan (summary · rounds · per-round rotation · stations
   * & loads · effort) — the SAME structure the plan drawer shows. When present it
   * renders via the shared `CardioPlanView` for full parity; `structure` is only a
   * fallback for sessions without a cardioPlan (e.g. legacy quick HYROX).
   */
  cardioPlan?: CardioPlanShape | null;
  loadedStations: HyroxLoadedStation[];
  isBenchmark?: boolean;
  divisionLabel?: string;
  stravaMatch?: HyroxStravaMatch | null;
}

function fmtMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseMmSs(v: string): number | null {
  const t = v.trim();
  if (/^\d+$/.test(t)) return Number(t) * 60; // bare minutes
  const m = t.match(/^(\d+):([0-5]?\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Local clock time (e.g. "18:42") for a Strava activity's start. */
function fmtClock(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** One-line summary of a candidate activity: "Morning Workout · 18:42 · 34 min · 156 bpm". */
function candidateLabel(c: StravaSessionCandidate): string {
  const parts = [
    c.name?.trim() || c.typeLabel,
    fmtClock(c.performedAt),
    `${Math.round(c.durationSec / 60)} min`,
  ];
  if (c.distanceKm != null) parts.push(`${c.distanceKm.toFixed(1)} km`);
  if (c.avgHrBpm != null) parts.push(`${c.avgHrBpm} bpm`);
  return parts.join(" · ");
}

export function HyroxCompletionForm({
  sessionId,
  title,
  weekLabel,
  structure,
  cardioPlan,
  loadedStations,
  isBenchmark,
  divisionLabel,
  stravaMatch,
}: HyroxCompletionFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, startSync] = useTransition();
  const [durationStr, setDurationStr] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(loadedStations.map((s) => [s.key, String(s.defaultKg)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [matchUsed, setMatchUsed] = useState(false);
  // Feedback after a manual "import from Strava" tap, and the avg-HR from a
  // manually-imported match (the prop `stravaMatch` is null on that path).
  const [notice, setNotice] = useState<{ kind: "ok" | "info"; text: string } | null>(null);
  const [importedAvgHr, setImportedAvgHr] = useState<number | null>(null);
  // Same-day Strava activities to choose from when the tight auto-match misses.
  const [candidates, setCandidates] = useState<StravaSessionCandidate[]>([]);

  const durationSec = parseMmSs(durationStr);
  const canSubmit = durationSec != null && durationSec > 0 && rpe != null && !pending;

  function useStravaMatch() {
    if (!stravaMatch) return;
    setDurationStr(fmtMmSs(stravaMatch.durationSec));
    setMatchUsed(true);
  }

  function pickCandidate(c: StravaSessionCandidate) {
    setDurationStr(fmtMmSs(c.durationSec));
    setImportedAvgHr(c.avgHrBpm);
    setMatchUsed(true);
    setCandidates([]);
    setNotice({
      kind: "ok",
      text: `Using your ${c.name?.trim() || c.typeLabel} from ${fmtClock(c.performedAt)} — time filled in. Set your RPE and complete.`,
    });
  }

  function manualImport() {
    setError(null);
    setNotice(null);
    setCandidates([]);
    startSync(async () => {
      const res = await syncStravaForSession(sessionId);
      if (!res.ok) {
        setError(res.error || "Couldn't reach Strava.");
        return;
      }
      if (res.match) {
        setDurationStr(fmtMmSs(res.match.durationSec));
        setImportedAvgHr(res.match.avgHrBpm);
        setMatchUsed(true);
        setNotice({ kind: "ok", text: "Found your Strava activity — time filled in. Set your RPE and complete." });
      } else if (res.candidates.length > 0) {
        setCandidates(res.candidates);
        setNotice({
          kind: "info",
          text: "Couldn't auto-match. Pick the activity you did from Strava:",
        });
      } else {
        setNotice({
          kind: "info",
          text: "Synced, but no Strava activity was found near this workout's time. Enter your time under \u201CHow it went\u201D.",
        });
      }
      router.refresh();
    });
  }

  function submit() {
    setError(null);
    if (durationSec == null || rpe == null) return;
    const confirmedWeights: Record<string, number> = {};
    for (const s of loadedStations) {
      const n = Number(weights[s.key]);
      if (Number.isFinite(n) && n > 0) confirmedWeights[s.key] = n;
    }
    const avgHrBpm = matchUsed ? (importedAvgHr ?? stravaMatch?.avgHrBpm ?? null) : null;
    startTransition(async () => {
      const res = await completeHyroxSession({
        sessionId,
        totalDurationSec: durationSec,
        sessionRpe: rpe,
        ...(Object.keys(confirmedWeights).length > 0 ? { confirmedWeights } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(avgHrBpm != null ? { avgHrBpm } : {}),
      });
      if (!res.ok) {
        setError(res.error || "Couldn't complete the session.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="cp-card" style={{ padding: 20, display: "grid", gap: 16 }}>
      <div>
        {weekLabel ? (
          <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--cp-text-muted)" }}>
            {weekLabel}
          </div>
        ) : null}
        <h2 style={{ fontFamily: "var(--cp-font-display)", fontSize: 22, margin: "4px 0 0" }}>{title}</h2>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {isBenchmark ? <Tag warn>★ Benchmark</Tag> : null}
          {divisionLabel ? <Tag>{divisionLabel}</Tag> : null}
        </div>
      </div>

      {stravaMatch && !matchUsed ? (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 12,
            background: "rgba(252,76,2,.12)", border: "1px solid rgba(252,76,2,.45)",
          }}
        >
          <StravaGlyph size={15} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{stravaMatch.label}</div>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              {stravaMatch.avgHrBpm ? `avg HR ${stravaMatch.avgHrBpm} · ` : ""}fills your time below
            </div>
          </div>
          <button type="button" onClick={useStravaMatch} style={stravaBtn}>Use it</button>
        </div>
      ) : null}

      <div>
        <Label>Structured workout</Label>
        {cardioPlan ? (
          <CardioPlanView plan={cardioPlan} />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {structure.map((row, i) => (
              <div key={i} style={rowStyle}>
                <span style={{ fontFamily: "var(--cp-font-display)", color: "var(--cp-text-muted)", width: 18, textAlign: "center", flex: "none" }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{row.name}</div>
                  {row.detail ? <div style={{ fontSize: 11.5, color: "var(--cp-text-muted)", marginTop: 2 }}>{row.detail}</div> : null}
                </div>
                {row.amount ? (
                  <span style={{ fontFamily: "var(--cp-font-display)", color: "var(--cp-text-soft)", flex: "none" }}>{row.amount}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {loadedStations.length > 0 ? (
        <div>
          <Label>Confirm the loads you used</Label>
          <div style={{ display: "grid", gap: 8 }}>
            {loadedStations.map((station) => (
              <div key={station.key} style={rowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{station.name}</div>
                  <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>{station.loadLabel}</div>
                </div>
                <span style={weightChip}>
                  <input
                    inputMode="numeric"
                    value={weights[station.key] ?? ""}
                    onChange={(e) => setWeights((w) => ({ ...w, [station.key]: e.target.value }))}
                    aria-label={`${station.name} weight (kg)`}
                    style={weightInput}
                  />
                  <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>kg</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <Label>How it went</Label>
        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--cp-text-soft)" }}>Total time (mm:ss)</span>
          <input
            value={durationStr}
            onChange={(e) => setDurationStr(e.target.value)}
            placeholder="e.g. 34:18"
            inputMode="numeric"
            style={textInput}
          />
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 13 }}>
          <span style={{ fontSize: 12, color: "var(--cp-text-soft)" }}>Session RPE — how hard overall?</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 5 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={rpe === n}
                onClick={() => setRpe(n)}
                style={{
                  aspectRatio: "1", borderRadius: 8, fontFamily: "var(--cp-font-display)", fontWeight: 600, fontSize: 13,
                  border: `1px solid ${rpe === n ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  background: rpe === n ? "var(--cp-accent)" : "var(--cp-surface)",
                  color: rpe === n ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
                  cursor: "pointer",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 13 }}>
          <span style={{ fontSize: 12, color: "var(--cp-text-soft)" }}>Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Pacing, transitions, how the sled felt…"
            style={{ ...textInput, resize: "none", fontFamily: "var(--cp-font-sans)" }}
          />
        </div>
      </div>

      {error ? <div style={{ color: "var(--cp-danger)", fontSize: 13 }}>{error}</div> : null}
      {notice ? (
        <div
          role="status"
          data-testid="strava-import-notice"
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            padding: "10px 12px",
            borderRadius: 10,
            color: notice.kind === "ok" ? "var(--cp-text)" : "var(--cp-text-muted)",
            background: notice.kind === "ok" ? "rgba(252,76,2,.10)" : "var(--cp-surface)",
            border: `1px solid ${notice.kind === "ok" ? "rgba(252,76,2,.40)" : "var(--cp-border)"}`,
          }}
        >
          {notice.text}
        </div>
      ) : null}
      {candidates.length > 0 ? (
        <div data-testid="strava-candidates" style={{ display: "grid", gap: 6 }}>
          {candidates.map((c) => (
            <button
              key={c.stravaActivityId}
              type="button"
              onClick={() => pickCandidate(c)}
              data-testid={`strava-candidate-${c.stravaActivityId}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface)",
                color: "var(--cp-text)",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <StravaGlyph size={13} />
              <span style={{ flex: 1 }}>{candidateLabel(c)}</span>
              <span style={{ fontSize: 12, color: "var(--cp-accent)", fontWeight: 600 }}>Use</span>
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        {!stravaMatch && !matchUsed ? (
          <button
            type="button"
            onClick={manualImport}
            disabled={syncing}
            style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            {syncing ? (
              "Checking Strava…"
            ) : (
              <>
                <StravaGlyph size={14} />
                {candidates.length > 0 ? "Re-sync Strava" : "Import session data from Strava"}
              </>
            )}
          </button>
        ) : null}
        <button type="button" onClick={submit} disabled={!canSubmit} style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.5 }}>
          {pending ? "Completing…" : "Complete session"}
        </button>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textAlign: "center", lineHeight: 1.5 }}>
          Muscle freshness updates only after you complete. Load is driven by time × RPE (sRPE).
        </div>
      </div>
    </section>
  );
}

/** The Strava brand mark, rendered in Strava orange (replaces the OS ⌚ emoji). */
function StravaGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#fc4c02"
      style={{ flex: "none" }}
    >
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
    </svg>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "var(--cp-font-display)", fontWeight: 500, letterSpacing: ".14em", fontSize: 11, textTransform: "uppercase", color: "var(--cp-text-muted)", margin: "0 0 9px" }}>
      {children}
    </div>
  );
}

function Tag({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11, padding: "4px 9px", borderRadius: 7,
        color: warn ? "var(--cp-warning)" : "var(--cp-text-soft)",
        background: warn ? "rgba(201,154,91,.10)" : "var(--cp-surface)",
        border: `1px solid ${warn ? "rgba(201,154,91,.32)" : "var(--cp-border)"}`,
      }}
    >
      {children}
    </span>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)", borderRadius: 12, padding: "11px 13px",
};
const weightChip: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5, flex: "none", background: "var(--cp-bg-elevated)",
  border: "1px solid var(--cp-border-strong)", borderRadius: 9, padding: "5px 8px",
};
const weightInput: React.CSSProperties = {
  width: 46, background: "transparent", border: "none", color: "var(--cp-text)",
  fontFamily: "var(--cp-font-display)", fontWeight: 600, fontSize: 15, textAlign: "right", outline: "none",
};
const textInput: React.CSSProperties = {
  background: "var(--cp-surface)", border: "1px solid var(--cp-border)", borderRadius: 12,
  color: "var(--cp-text)", fontSize: 14, padding: "12px 14px", outline: "none",
};
const primaryBtn: React.CSSProperties = {
  borderRadius: 12, padding: 14, fontFamily: "var(--cp-font-display)", fontWeight: 600,
  letterSpacing: ".06em", textTransform: "uppercase", fontSize: 14, textAlign: "center",
  background: "var(--cp-accent)", color: "var(--cp-accent-fg)", border: "none", cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  borderRadius: 12, padding: 14, fontFamily: "var(--cp-font-display)", fontWeight: 600,
  letterSpacing: ".06em", textTransform: "uppercase", fontSize: 14, textAlign: "center",
  background: "transparent", color: "var(--cp-text-soft)", border: "1px solid var(--cp-border-strong)", cursor: "pointer",
};
const stravaBtn: React.CSSProperties = {
  flex: "none", fontFamily: "var(--cp-font-display)", fontWeight: 600, letterSpacing: ".04em", fontSize: 12,
  textTransform: "uppercase", color: "#fff", background: "#fc4c02", border: "1px solid #fc4c02",
  borderRadius: 8, padding: "6px 12px", cursor: "pointer",
};
