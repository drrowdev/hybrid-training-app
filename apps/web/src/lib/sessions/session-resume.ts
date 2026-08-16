/**
 * Resume state for an in-progress session.
 *
 * A workout is the most interruption-prone screen in the app: the phone locks
 * between sets, the browser evicts the tab while you're on Instagram, iOS kills
 * a backgrounded PWA under memory pressure. Logged sets already survive all of
 * that (they're persisted, or queued in the offline outbox). What did NOT
 * survive was everything around them:
 *
 *   - which movement you were on
 *   - which slot inside it
 *   - the numbers you'd dialled in but not yet logged
 *   - how much rest was left
 *
 * The rest countdown is the sharp edge. `RestTimer` derives its remaining time
 * from wall-clock (`Date.now() - start`), so it already survives a THROTTLED
 * interval while backgrounded — but not a reload, because the start instant
 * lived only in memory. Persisting an absolute deadline means a reload resumes
 * the same countdown instead of silently restarting or dropping it.
 *
 * Everything here is best-effort UI convenience: losing it degrades to today's
 * behaviour and never risks logged data.
 */

const KEY_PREFIX = "hta.session-resume.";

/**
 * Resume state older than this is discarded. A workout you abandoned yesterday
 * should not restore a stale cursor — or worse, a stale rest countdown — when
 * you reopen the session.
 */
export const RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type ResumeDraft = {
  weightKg?: number;
  reps?: number;
  rpe?: number | null;
  distanceM?: number;
  durationSec?: number;
  externalLoadKg?: number;
};

export type ResumeState = {
  sessionId: string;
  /** Movement group key the user was on. */
  activeKey?: string;
  /** Slot within that movement. */
  cursor?: number;
  /** Movement the draft belongs to — a draft must never leak across lifts. */
  draftKey?: string;
  draft?: ResumeDraft;
  /** Absolute epoch ms the rest countdown ends at. */
  restDeadlineMs?: number;
  /** Movement name shown in the rest row, so the label survives too. */
  restLabel?: string;
  savedAt: number;
};

/** Whole seconds of rest left at `now`. Clamped at 0; never negative. */
export function remainingRestSeconds(
  restDeadlineMs: number | undefined,
  now: number,
): number {
  if (restDeadlineMs == null) return 0;
  return Math.max(0, Math.ceil((restDeadlineMs - now) / 1000));
}

/** Is this state fresh enough, and for the session we're actually opening? */
export function isResumable(
  state: ResumeState | null,
  sessionId: string,
  now: number,
): state is ResumeState {
  if (!state) return false;
  if (state.sessionId !== sessionId) return false;
  if (!Number.isFinite(state.savedAt)) return false;
  // A clock that moved backwards (timezone change, NTP correction) would make
  // `now - savedAt` negative; treat anything not plausibly recent as stale.
  const age = now - state.savedAt;
  return age >= 0 && age <= RESUME_MAX_AGE_MS;
}

/**
 * A draft only applies to the movement AND slot it was captured on. Restoring
 * a squat's 115 kg onto a lateral raise would be worse than restoring nothing.
 */
export function draftAppliesTo(
  state: ResumeState,
  activeKey: string,
  cursor: number,
): boolean {
  return (
    state.draft != null &&
    state.draftKey === activeKey &&
    state.cursor === cursor
  );
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Private mode / storage disabled — resume is a nicety, never a hard dep.
    return null;
  }
}

export function readResume(sessionId: string, now = Date.now()): ResumeState | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY_PREFIX + sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeState;
    if (!isResumable(parsed, sessionId, now)) {
      store.removeItem(KEY_PREFIX + sessionId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeResume(state: Omit<ResumeState, "savedAt">, now = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      KEY_PREFIX + state.sessionId,
      JSON.stringify({ ...state, savedAt: now } satisfies ResumeState),
    );
  } catch {
    // Quota / disabled storage — silently degrade.
  }
}

export function clearResume(sessionId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY_PREFIX + sessionId);
  } catch {
    // ignore
  }
}
