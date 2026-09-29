"use client";

/**
 * Quick-workout bottom sheet — fired from `<QuickWorkoutCard>` on the
 * Today page. Quick workouts are STRENGTH-ONLY: the sheet offers a
 * single "Strength" start plus, when available, a "Recent" list of
 * completed strength workouts the user can clone with one tap.
 *
 * Cardio is intentionally NOT a quick-workout option. In-app cardio
 * capture (GPS live tracking) was removed — cardio is entered manually on a
 * planned cardio session. Steering ad-hoc cardio out of the quick-workout
 * picker keeps that mental model clean.
 *
 * Both the Strength start and every Recent row call a server action
 * exposed via props rather than imported directly — keeps the component
 * pure for tests and lets the page wire the actions once.
 *
 * Generated workouts (Strength Short/Normal, HYROX) open a review step first:
 * the preview action builds a draft without writing anything, the user can
 * regenerate or remove movements, and only "Start workout" creates the session.
 *
 * Wraps the shared `<BottomSheet>` for the backdrop + swipe-down UX.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { WorkoutExercises } from "@/components/today/WorkoutExercises";
import todayStyles from "@/components/today/Today.module.css";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";
import {
  quickDraftMovementIds,
  quickDraftPrescription,
  type QuickHyroxDraft,
  type QuickPreviewResult,
  type QuickStartResult,
  type QuickStrengthDraft,
} from "@/lib/sessions/quick-workout-draft";
import type { QuickRepeatCandidate } from "@/lib/sessions/queries";

type QuickLength = "short" | "normal";

export type StartStrengthFn = () => Promise<string>;
export type RepeatFn = (input: { sessionId: string }) => Promise<string>;
export type PreviewStrengthFn = (input: {
  length: QuickLength;
}) => Promise<QuickPreviewResult<QuickStrengthDraft>>;
export type GenerateStrengthFn = (input: {
  length: QuickLength;
  seed: number;
  movementIds: string[];
  removedMovementIds: string[];
}) => Promise<QuickStartResult<QuickStrengthDraft>>;
export type HyroxStation =
  | "run"
  | "ski_erg"
  | "rower"
  | "sled"
  | "sandbag"
  | "wall_ball"
  | "farmers"
  | "burpees";
export type PreviewHyroxFn = (input: {
  length: QuickLength;
  stations: HyroxStation[];
}) => Promise<QuickPreviewResult<QuickHyroxDraft>>;
export type GenerateHyroxFn = (input: {
  length: QuickLength;
  stations: HyroxStation[];
  format: QuickHyroxDraft["format"];
}) => Promise<QuickStartResult<QuickHyroxDraft>>;

type Review =
  | { kind: "strength"; draft: QuickStrengthDraft; removed: string[] }
  | { kind: "hyrox"; draft: QuickHyroxDraft };

const GENERIC_ERROR = "Something went wrong. Try again.";

const HYROX_STATION_LABELS: { id: HyroxStation; label: string }[] = [
  { id: "run", label: "Run" },
  { id: "ski_erg", label: "Ski Erg" },
  { id: "rower", label: "Rower" },
  { id: "sled", label: "Sled" },
  { id: "sandbag", label: "Sandbag" },
  { id: "wall_ball", label: "Wall Ball" },
  { id: "farmers", label: "Farmers" },
  { id: "burpees", label: "Burpees" },
];

export function QuickWorkoutSheet({
  open,
  onClose,
  recent,
  startStrength,
  repeatRecent,
  previewStrength,
  generateStrength,
  previewHyrox,
  generateHyrox,
  hyroxStationDefaults,
  initialReview = null,
}: {
  open: boolean;
  onClose: () => void;
  recent: QuickRepeatCandidate[];
  startStrength: StartStrengthFn;
  repeatRecent: RepeatFn;
  previewStrength: PreviewStrengthFn;
  generateStrength: GenerateStrengthFn;
  previewHyrox: PreviewHyroxFn;
  generateHyrox: GenerateHyroxFn;
  hyroxStationDefaults: HyroxStation[];
  /** Test/preview seam: open straight into the review step. */
  initialReview?: Review | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [modality, setModality] = useState<"strength" | "hyrox">("strength");
  const [review, setReview] = useState<Review | null>(initialReview);
  const [error, setError] = useState<string | null>(null);
  const [stations, setStations] = useState<Set<HyroxStation>>(
    () => new Set(hyroxStationDefaults),
  );
  const toggleStation = (id: HyroxStation) =>
    setStations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // circuit needs ≥2 stations; erg/run need their option; so allow generate when
  // ≥2 selected OR (run/erg present). Keep it simple: ≥1 station of any kind.
  const stationCount = [...stations].filter((s) => s !== "run").length;
  const canGenerateHyrox =
    stations.has("ski_erg") ||
    stations.has("rower") ||
    stations.has("run") ||
    stationCount >= 2;

  const fire = (id: string, fn: () => Promise<string>) => {
    if (pending) return;
    setPendingId(id);
    setError(null);
    startTransition(async () => {
      try {
        const sessionId = await fn();
        // Navigate client-side so the destination's loading.tsx skeleton
        // shows instantly — a server-action redirect() would instead block
        // this transition until the full session RSC was ready ("Starting…"
        // hang). The create itself is a single insert round-trip.
        if (sessionId) router.push(`/app/sessions/${sessionId}`);
      } catch (err) {
        // A server action that still redirects throws `NEXT_REDIRECT`; that's
        // expected and not an error path the user needs to see.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/NEXT_REDIRECT/i.test(msg)) {
          console.error("[quick-workout] action failed", err);
          setPendingId(null);
          setError(GENERIC_ERROR);
        }
      }
    });
  };

  const openReview = (
    id: string,
    fn: () => Promise<QuickPreviewResult<QuickStrengthDraft | QuickHyroxDraft>>,
    kind: Review["kind"],
  ) => {
    if (pending) return;
    setPendingId(id);
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.ok) {
          setReview(
            kind === "strength"
              ? { kind, draft: result.draft as QuickStrengthDraft, removed: [] }
              : { kind, draft: result.draft as QuickHyroxDraft },
          );
        } else {
          setError(result.error);
        }
      } catch (err) {
        console.error("[quick-workout] preview failed", err);
        setError(GENERIC_ERROR);
      } finally {
        setPendingId(null);
      }
    });
  };

  const startReviewed = () => {
    if (pending || !review) return;
    setPendingId("start");
    setError(null);
    startTransition(async () => {
      try {
        const result: QuickStartResult<QuickStrengthDraft | QuickHyroxDraft> =
          review.kind === "strength"
            ? await generateStrength({
                length: review.draft.length,
                seed: review.draft.seed,
                movementIds: quickDraftMovementIds(review.draft.items),
                removedMovementIds: review.removed,
              })
            : await generateHyrox({
                length: review.draft.length,
                stations: review.draft.stations,
                format: review.draft.format,
              });
        if (result.ok) {
          router.push(`/app/sessions/${result.sessionId}`);
          return;
        }
        setError(result.error);
        if (result.draft) {
          setReview(
            review.kind === "strength"
              ? { kind: "strength", draft: result.draft as QuickStrengthDraft, removed: [] }
              : { kind: "hyrox", draft: result.draft as QuickHyroxDraft },
          );
        }
        setPendingId(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/NEXT_REDIRECT/i.test(msg)) {
          console.error("[quick-workout] start failed", err);
          setError(GENERIC_ERROR);
          setPendingId(null);
        }
      }
    });
  };

  const close = () => {
    setReview(null);
    setError(null);
    onClose();
  };

  if (review) {
    return (
      <BottomSheet
        open={open}
        onClose={close}
        testId="quick-workout-sheet"
        ariaLabelledById="quick-workout-sheet-title"
        title={
          <h2
            id="quick-workout-sheet-title"
            style={{ margin: 0, fontSize: 16, fontWeight: 700 }}
          >
            {review.draft.title}
          </h2>
        }
      >
        <ReviewPanel
          review={review}
          error={error}
          pendingId={pendingId}
          disabled={pending}
          onBack={() => {
            setReview(null);
            setError(null);
          }}
          onRemove={(movementId) =>
            review.kind === "strength" &&
            setReview({ ...review, removed: [...review.removed, movementId] })
          }
          onUndo={() =>
            review.kind === "strength" &&
            setReview({ ...review, removed: review.removed.slice(0, -1) })
          }
          onRegenerate={() =>
            review.kind === "strength" &&
            openReview(
              "regenerate",
              () => previewStrength({ length: review.draft.length }),
              "strength",
            )
          }
          onStart={startReviewed}
        />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      open={open}
      onClose={close}
      testId="quick-workout-sheet"
      ariaLabelledById="quick-workout-sheet-title"
      title={
        <div>
          <h2
            id="quick-workout-sheet-title"
            style={{ margin: 0, fontSize: 16, fontWeight: 700 }}
          >
            Quick workout
          </h2>
        </div>
      }
    >
      <div
        role="tablist"
        aria-label="Quick workout type"
        data-testid="quick-modality-toggle"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 4,
          padding: 4,
          background: "var(--cp-surface-soft)",
          borderRadius: 10,
          marginBottom: 16,
        }}
      >
        {(["strength", "hyrox"] as const).map((m) => {
          const active = modality === m;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`quick-modality-${m}`}
              onClick={() => setModality(m)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                font: "inherit",
                fontSize: 13,
                fontWeight: 600,
                background: active ? "var(--cp-accent)" : "transparent",
                color: active ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
              }}
            >
              {m === "strength" ? "Strength" : "HYROX"}
            </button>
          );
        })}
      </div>

      {modality === "hyrox" ? (
        <div data-testid="quick-hyrox" style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            What can you do right now?
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {HYROX_STATION_LABELS.map(({ id, label }) => {
              const on = stations.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  data-testid={`quick-hyrox-station-${id}`}
                  onClick={() => toggleStation(id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--cp-border)",
                    background: on ? "var(--cp-accent)" : "transparent",
                    color: on ? "var(--cp-accent-fg)" : "var(--cp-text)",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 13,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <GenerateTile
              length="short"
              label="Short"
              sublabel="~30 min"
              disabled={pending || !canGenerateHyrox}
              loading={pendingId === "hyrox:short"}
              onClick={() =>
                openReview(
                  "hyrox:short",
                  () => previewHyrox({ length: "short", stations: [...stations] }),
                  "hyrox",
                )
              }
            />
            <GenerateTile
              length="normal"
              label="Normal"
              sublabel="up to ~60 min"
              disabled={pending || !canGenerateHyrox}
              loading={pendingId === "hyrox:normal"}
              onClick={() =>
                openReview(
                  "hyrox:normal",
                  () => previewHyrox({ length: "normal", stations: [...stations] }),
                  "hyrox",
                )
              }
            />
          </div>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 11,
              color: "var(--cp-text-muted)",
              lineHeight: 1.4,
            }}
          >
            {canGenerateHyrox
              ? "Station weights follow your division standard."
              : "Pick an erg or run, or at least two stations, to generate."}
          </p>
        </div>
      ) : (
        <>
      <div
        data-testid="quick-workout-generate"
        style={{ display: "grid", gap: 8 }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Generate workout
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <GenerateTile
            length="short"
            label="Short"
            sublabel="~30 min"
            disabled={pending}
            loading={pendingId === "generate:short"}
            onClick={() =>
              openReview(
                "generate:short",
                () => previewStrength({ length: "short" }),
                "strength",
              )
            }
          />
          <GenerateTile
            length="normal"
            label="Normal"
            sublabel="up to ~60 min"
            disabled={pending}
            loading={pendingId === "generate:normal"}
            onClick={() =>
              openReview(
                "generate:normal",
                () => previewStrength({ length: "normal" }),
                "strength",
              )
            }
          />
        </div>
      </div>

      <div
        data-testid="quick-workout-tiles"
        style={{ display: "grid", gap: 10, marginTop: 20 }}
      >
        <StrengthTile
          disabled={pending}
          loading={pendingId === "strength"}
          onClick={() => fire("strength", () => startStrength())}
        />
      </div>

      {recent.length > 0 && (
        <div
          data-testid="quick-workout-recent"
          style={{ marginTop: 20, display: "grid", gap: 8 }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Recent
          </div>
          {recent.map((s) => (
            <RecentRow
              key={s.id}
              candidate={s}
              disabled={pending}
              loading={pendingId === `repeat:${s.id}`}
              onRepeat={() =>
                fire(`repeat:${s.id}`, () => repeatRecent({ sessionId: s.id }))
              }
            />
          ))}
        </div>
      )}
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </BottomSheet>
  );
}

function ErrorText({ children }: { children: string }) {
  return (
    <p
      role="alert"
      data-testid="quick-workout-error"
      style={{ margin: "12px 0 0", fontSize: 13, color: "var(--cp-danger)" }}
    >
      {children}
    </p>
  );
}

function ReviewPanel({
  review,
  error,
  pendingId,
  disabled,
  onBack,
  onRemove,
  onUndo,
  onRegenerate,
  onStart,
}: {
  review: Review;
  error: string | null;
  pendingId: string | null;
  disabled: boolean;
  onBack: () => void;
  onRemove: (movementId: string) => void;
  onUndo: () => void;
  onRegenerate: () => void;
  onStart: () => void;
}) {
  const strengthItems =
    review.kind === "strength"
      ? quickDraftPrescription(review.draft.items, review.removed).items
      : [];
  const movementCount = quickDraftMovementIds(strengthItems).length;
  const minutes =
    review.kind === "strength" ? estimateSessionMinutes(strengthItems) : null;
  const lastRemovedId =
    review.kind === "strength" ? review.removed.at(-1) : undefined;
  const lastRemovedName = lastRemovedId
    ? review.kind === "strength" &&
      review.draft.items.find((item) => item.movementId === lastRemovedId)
        ?.movementName
    : null;
  const meta =
    review.kind === "strength"
      ? [
          `${movementCount} ${movementCount === 1 ? "movement" : "movements"}`,
          minutes != null ? `~${minutes} min` : null,
        ]
      : [
          review.draft.length === "short" ? "~30 min" : "up to ~60 min",
          review.draft.view.divisionLabel,
        ];

  return (
    <div data-testid="quick-review" style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <button
          type="button"
          className="cp-btn ghost"
          data-testid="quick-review-back"
          onClick={onBack}
          disabled={disabled}
          style={{ padding: "6px 8px", marginLeft: -8, fontSize: 13 }}
        >
          ‹ Back
        </button>
        <span
          data-testid="quick-review-meta"
          style={{ fontSize: 13, color: "var(--cp-text-muted)" }}
        >
          {meta.filter(Boolean).join(" · ")}
        </span>
      </div>

      <div
        style={{
          background: "var(--cp-bg)",
          border: "1px solid var(--cp-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {review.kind === "strength" ? (
          <WorkoutExercises
            items={strengthItems}
            onRemove={movementCount > 1 && !disabled ? onRemove : undefined}
          />
        ) : (
          <HyroxReview draft={review.draft} />
        )}
      </div>

      {lastRemovedName && (
        <div
          data-testid="quick-review-removed"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 13,
            color: "var(--cp-text-muted)",
          }}
        >
          <span>Removed {lastRemovedName}</span>
          <button
            type="button"
            className="cp-btn ghost"
            data-testid="quick-review-undo"
            onClick={onUndo}
            disabled={disabled}
            style={{ padding: "6px 8px", marginRight: -8, fontSize: 13 }}
          >
            Undo
          </button>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: review.kind === "strength" ? "1fr 1fr" : "1fr",
          gap: 8,
        }}
      >
        {review.kind === "strength" && (
          <button
            type="button"
            className="cp-btn big"
            data-testid="quick-review-regenerate"
            onClick={onRegenerate}
            disabled={disabled}
          >
            {pendingId === "regenerate" ? "Generating…" : "Regenerate"}
          </button>
        )}
        <button
          type="button"
          className="cp-btn primary big"
          data-testid="quick-review-start"
          onClick={onStart}
          disabled={disabled}
        >
          {pendingId === "start" ? "Starting…" : "Start workout"}
        </button>
      </div>
    </div>
  );
}

function HyroxReview({ draft }: { draft: QuickHyroxDraft }) {
  const s = todayStyles;
  return (
    <div className={s.groups} data-testid="quick-review-hyrox">
      <section className={s.group}>
        <h3>Workout</h3>
        <ul className={s.rows}>
          {draft.view.structure.map((row, index) => (
            <li className={s.exercise} key={`${row.name}-${index}`}>
              <div>
                {row.name}
                {row.detail && <div className={s.cue}>{row.detail}</div>}
              </div>
              {row.amount && <span className={s.dose}>{row.amount}</span>}
            </li>
          ))}
        </ul>
      </section>
      {draft.view.loadedStations.length > 0 && (
        <section className={s.group}>
          <h3>Weights</h3>
          <ul className={s.rows}>
            {draft.view.loadedStations.map((station) => (
              <li className={s.exercise} key={station.key}>
                <span>{station.name}</span>
                <span className={s.dose}>{station.loadLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StrengthTile({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid="quick-tile-strength"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 16,
        background: "var(--cp-bg)",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1,
        textAlign: "left",
        color: "var(--cp-text)",
        font: "inherit",
        width: "100%",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "var(--cp-accent-soft)",
          color: "var(--cp-accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 700,
          flex: "0 0 auto",
        }}
      >
        🏋️
      </span>
      <span style={{ display: "grid", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Start empty</span>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          {loading ? "Starting…" : "build your own"}
        </span>
      </span>
    </button>
  );
}

function GenerateTile({
  length,
  label,
  sublabel,
  onClick,
  disabled,
  loading,
}: {
  length: "short" | "normal";
  label: string;
  sublabel: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={`quick-tile-generate-${length}`}
      data-loading={loading ? "true" : "false"}
      onClick={onClick}
      disabled={disabled}
      className="cp-generate-tile"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        padding: 14,
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1,
        textAlign: "left",
        color: "var(--cp-text)",
        font: "inherit",
        width: "100%",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700 }}>
        {loading ? "Generating…" : label}
      </span>
      <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
        {sublabel}
      </span>
    </button>
  );
}

function RecentRow({
  candidate,
  onRepeat,
  disabled,
  loading,
}: {
  candidate: QuickRepeatCandidate;
  onRepeat: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const dow = dayOfWeekShort(candidate.performedAt);
  return (
    <div
      data-testid={`quick-recent-${candidate.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: "var(--cp-bg)",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {candidate.title ?? "Untitled"}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            marginTop: 2,
          }}
        >
          {candidate.summary} · {dow}
        </div>
      </div>
      <button
        type="button"
        className="cp-btn"
        data-testid={`quick-recent-repeat-${candidate.id}`}
        onClick={onRepeat}
        disabled={disabled}
        style={{ fontSize: 13, padding: "6px 12px" }}
      >
        {loading ? "Starting…" : "Repeat"}
      </button>
    </div>
  );
}

function dayOfWeekShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
