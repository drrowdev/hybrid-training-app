"use client";

/**
 * Auto-save hook for configuration fields.
 *
 * Each instance owns one value, debounces text/number changes, fires
 * an idempotent server action, and exposes a four-state status
 * (idle | saving | saved | error) for inline feedback. A monotonic
 * `inflightRef` token guarantees that when a newer save supersedes
 * an older one the older one can't flip the status back to "saved"
 * after the newer one already settled.
 *
 * Designed to keep the user's typed value on error (no rollback) so
 * they can retry without losing input.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveOptions<TValue> {
  initial: TValue;
  /** Server action that persists the value. */
  save: (value: TValue) => Promise<void>;
  /** Debounce window for text/number inputs (0 = instant). */
  debounceMs?: number;
  /** Skip the save when the value compares equal to the last persisted one. */
  equals?: (a: TValue, b: TValue) => boolean;
}

export interface UseAutoSaveResult<TValue> {
  value: TValue;
  /** Update local value + schedule (or fire) a save. */
  setValue: (next: TValue) => void;
  /** Replace local value without scheduling a save. */
  reset: (next: TValue) => void;
  /** Fire a save with the current local value immediately, bypassing the debounce. */
  flushNow: () => void;
  status: AutoSaveStatus;
  lastError: string | null;
  retry: () => void;
}

export function useAutoSave<TValue>(
  opts: UseAutoSaveOptions<TValue>,
): UseAutoSaveResult<TValue> {
  const [value, setValueState] = useState<TValue>(opts.initial);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<number>(0);
  const lastSavedRef = useRef<TValue>(opts.initial);
  const saveRef = useRef(opts.save);
  const equalsRef = useRef(opts.equals);
  useEffect(() => {
    saveRef.current = opts.save;
    equalsRef.current = opts.equals;
  });
  const debounceMs = opts.debounceMs ?? 0;

  const flush = useCallback(async (next: TValue) => {
    const eq = equalsRef.current ?? Object.is;
    if (eq(next, lastSavedRef.current)) {
      // Nothing to do.
      return;
    }
    const myToken = ++inflightRef.current;
    setStatus("saving");
    setLastError(null);
    try {
      await saveRef.current(next);
      if (inflightRef.current !== myToken) return; // a newer save took over
      lastSavedRef.current = next;
      setStatus("saved");
      // Fade the "saved" pill back to idle after a short success window.
      setTimeout(() => {
        if (inflightRef.current === myToken) setStatus("idle");
      }, 1500);
    } catch (err) {
      if (inflightRef.current !== myToken) return;
      setStatus("error");
      setLastError(err instanceof Error ? err.message : "Save failed");
    }
  }, []);

  const setValue = useCallback(
    (next: TValue) => {
      setValueState(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (debounceMs > 0) {
        timerRef.current = setTimeout(() => void flush(next), debounceMs);
      } else {
        void flush(next);
      }
    },
    [flush, debounceMs],
  );

  const flushNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void flush(value);
  }, [flush, value]);

  const reset = useCallback((next: TValue) => {
    setValueState(next);
    lastSavedRef.current = next;
  }, []);

  const retry = useCallback(() => void flush(value), [flush, value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { value, setValue, reset, flushNow, status, lastError, retry };
}
