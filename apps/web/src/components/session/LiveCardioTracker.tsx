"use client";

/**
 * Live cardio tracker — the foreground-first capture experience for cardio
 * workouts on mobile (and desktop). It turns a cardio session from a manual
 * "type in your duration" form into a live session with a running clock,
 * GPS distance + pace, and a screen-wake-lock so the phone stays on mid-run.
 *
 * Architecture (deliberately minimal-surface):
 *   - ALL capture math lives in pure helpers (`lib/cardio/live-tracker.ts`),
 *     unit-tested without a DOM.
 *   - This component owns only the browser side effects: Geolocation
 *     `watchPosition`, the Wake Lock API, and the interval clock.
 *   - On finish it hands the MEASURED duration + distance to the existing
 *     `CardioLogForm`, which submits through the unchanged `logCardioSession`
 *     server action. No new server path, migration, or RLS surface.
 *
 * Foreground only: iOS suspends a backgrounded web view, so GPS pauses if
 * the user leaves the app. Background GPS + Bluetooth HR are the native
 * (Capacitor) follow-up; this UI is the shell they will slot into.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CardioLogForm, type CardioLogFormProps } from "./CardioLogForm";
import {
  initTrackState,
  accumulateSample,
  metersToDisplay,
  metersToKm,
  paceSecPerUnit,
  speedToPaceSecPerUnit,
  formatPace,
  formatClock,
  formatDistance,
  elapsedToDurationMin,
  type TrackState,
} from "@/lib/cardio/live-tracker";

type Mode = "choice" | "tracking" | "finish" | "manual";
type GpsStatus = "idle" | "acquiring" | "ok" | "denied" | "unavailable";

export type LiveCardioTrackerProps = CardioLogFormProps;

export function LiveCardioTracker(props: LiveCardioTrackerProps) {
  const { units, stravaApplied } = props;

  // Strava-applied sessions already hold authoritative data — never offer
  // live tracking, just render the (collapsed) finish form.
  const [mode, setMode] = useState<Mode>(stravaApplied ? "manual" : "choice");

  const [indoor, setIndoor] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [track, setTrack] = useState<TrackState>(initTrackState());
  const [livePaceSecPerUnit, setLivePaceSecPerUnit] = useState<number | null>(
    null,
  );
  const [gps, setGps] = useState<GpsStatus>("idle");

  // Captured values frozen at finish time, fed into CardioLogForm.
  const [capturedDurationMin, setCapturedDurationMin] = useState<number | null>(
    null,
  );
  const [capturedDistanceKm, setCapturedDistanceKm] = useState<number | null>(
    null,
  );

  // --- refs for side-effect bookkeeping ---
  const runningRef = useRef(false);
  const indoorRef = useRef(false);
  const accumulatedSecRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchIdRef = useRef<number | null>(null);
  // WakeLockSentinel isn't in every TS DOM lib target — keep it loose.
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const recomputeElapsed = useCallback(() => {
    const live =
      runningRef.current && segmentStartRef.current != null
        ? (Date.now() - segmentStartRef.current) / 1000
        : 0;
    setElapsedSec(accumulatedSecRef.current + live);
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (t: "screen") => Promise<unknown> };
      };
      if (nav.wakeLock?.request) {
        wakeLockRef.current = (await nav.wakeLock.request(
          "screen",
        )) as { release: () => Promise<void> };
      }
    } catch {
      // Wake lock is best-effort; denial just means the screen may dim.
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release();
    } catch {
      /* ignore */
    }
    wakeLockRef.current = null;
  }, []);

  const startGps = useCallback(() => {
    if (indoorRef.current) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGps("unavailable");
      return;
    }
    setGps("acquiring");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGps("ok");
        if (!runningRef.current) return; // ignore fixes while paused
        const { latitude, longitude, accuracy, speed } = pos.coords;
        setTrack((prev) =>
          accumulateSample(prev, {
            lat: latitude,
            lon: longitude,
            accuracyM: accuracy ?? 9999,
            t: pos.timestamp,
          }),
        );
        setLivePaceSecPerUnit(speedToPaceSecPerUnit(speed, units));
      },
      (err) => {
        setGps(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  }, [units]);

  const stopGps = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const start = useCallback(() => {
    runningRef.current = true;
    indoorRef.current = indoor;
    segmentStartRef.current = Date.now();
    setRunning(true);
    setMode("tracking");
    if (!tickRef.current) {
      tickRef.current = setInterval(recomputeElapsed, 250);
    }
    void acquireWakeLock();
    startGps();
  }, [indoor, recomputeElapsed, acquireWakeLock, startGps]);

  const pause = useCallback(() => {
    if (segmentStartRef.current != null) {
      accumulatedSecRef.current +=
        (Date.now() - segmentStartRef.current) / 1000;
      segmentStartRef.current = null;
    }
    runningRef.current = false;
    setRunning(false);
    setLivePaceSecPerUnit(null);
    void releaseWakeLock();
    recomputeElapsed();
  }, [releaseWakeLock, recomputeElapsed]);

  const resume = useCallback(() => {
    runningRef.current = true;
    segmentStartRef.current = Date.now();
    setRunning(true);
    void acquireWakeLock();
  }, [acquireWakeLock]);

  const finish = useCallback(() => {
    // Fold the final live segment in.
    if (segmentStartRef.current != null) {
      accumulatedSecRef.current +=
        (Date.now() - segmentStartRef.current) / 1000;
      segmentStartRef.current = null;
    }
    runningRef.current = false;
    setRunning(false);
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    stopGps();
    void releaseWakeLock();

    setCapturedDurationMin(elapsedToDurationMin(accumulatedSecRef.current));
    const km = metersToKm(track.totalMeters);
    setCapturedDistanceKm(!indoorRef.current && km > 0 ? km : null);
    setMode("finish");
  }, [stopGps, releaseWakeLock, track.totalMeters]);

  // Re-acquire the wake lock when the tab returns to the foreground.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && runningRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [acquireWakeLock]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      void wakeLockRef.current?.release();
    };
  }, []);

  // --- render ---

  if (mode === "manual" || mode === "finish") {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {mode === "finish" && (
          <div
            data-testid="live-cardio-summary"
            style={{
              display: "flex",
              gap: 16,
              alignItems: "baseline",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--cp-border)",
              background:
                "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
            }}
          >
            <SummaryStat
              label="Tracked"
              value={formatClock(Math.round((capturedDurationMin ?? 0) * 60))}
            />
            {capturedDistanceKm != null && (
              <SummaryStat
                label={`Distance (${units === "imperial" ? "mi" : "km"})`}
                value={formatDistance(
                  metersToDisplay(capturedDistanceKm * 1000, units),
                )}
              />
            )}
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "var(--cp-text-muted)",
              }}
            >
              Add how it felt to finish.
            </span>
          </div>
        )}
        <CardioLogForm
          {...props}
          initialDurationMin={
            mode === "finish" ? capturedDurationMin : props.initialDurationMin
          }
          initialDistanceKm={
            mode === "finish" ? capturedDistanceKm : props.initialDistanceKm
          }
        />
      </div>
    );
  }

  if (mode === "choice") {
    return (
      <div
        data-testid="live-cardio-choice"
        className="cp-card"
        style={{ padding: 16, display: "grid", gap: 12, marginInline: -16 }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Track this cardio
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
          Start a live session with a running clock
          {indoor ? "" : ", GPS distance and pace"}, and a screen that stays on.
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            data-testid="live-cardio-indoor"
            checked={indoor}
            onChange={(e) => setIndoor(e.target.checked)}
          />
          Indoor / treadmill (timer only, no GPS)
        </label>
        <button
          type="button"
          data-testid="live-cardio-start"
          onClick={start}
          className="cp-btn primary big"
          style={{ minHeight: 52, justifyContent: "center" }}
        >
          Start live tracking →
        </button>
        <button
          type="button"
          data-testid="live-cardio-manual"
          onClick={() => setMode("manual")}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            fontSize: 13,
            color: "var(--cp-text-muted)",
            textDecoration: "underline",
            cursor: "pointer",
            justifySelf: "center",
          }}
        >
          Log manually instead
        </button>
      </div>
    );
  }

  // mode === "tracking"
  const distanceDisplay = metersToDisplay(track.totalMeters, units);
  const distUnit = units === "imperial" ? "mi" : "km";
  const avgPace = paceSecPerUnit(elapsedSec, track.totalMeters, units);
  const showGps = !indoor;

  return (
    <div
      data-testid="live-cardio-tracking"
      className="cp-card"
      style={{
        padding: 18,
        display: "grid",
        gap: 16,
        marginInline: -16,
        textAlign: "center",
      }}
    >
      <div
        data-testid="live-cardio-clock"
        style={{
          fontSize: 56,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {formatClock(elapsedSec)}
      </div>

      {showGps && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <Metric
            label={`Distance (${distUnit})`}
            value={formatDistance(distanceDisplay)}
            testid="live-cardio-distance"
          />
          <Metric
            label={`Pace (/${distUnit})`}
            value={formatPace(livePaceSecPerUnit ?? avgPace)}
            testid="live-cardio-pace"
          />
        </div>
      )}

      {showGps && (
        <div
          data-testid="live-cardio-gps-status"
          style={{ fontSize: 12, color: gpsHintColor(gps) }}
        >
          {gpsHint(gps)}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        {running ? (
          <button
            type="button"
            data-testid="live-cardio-pause"
            onClick={pause}
            className="cp-btn"
            style={{ flex: 1, minHeight: 48, justifyContent: "center" }}
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            data-testid="live-cardio-resume"
            onClick={resume}
            className="cp-btn"
            style={{ flex: 1, minHeight: 48, justifyContent: "center" }}
          >
            Resume
          </button>
        )}
        <button
          type="button"
          data-testid="live-cardio-finish"
          onClick={finish}
          className="cp-btn primary"
          style={{ flex: 1, minHeight: 48, justifyContent: "center" }}
        >
          Finish →
        </button>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  testid,
}: {
  label: string;
  value: string;
  testid: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
      }}
    >
      <span style={statLabelStyle}>{label}</span>
      <span
        data-testid={testid}
        style={{
          fontSize: 26,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "grid", gap: 2 }}>
      <span style={statLabelStyle}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

const statLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
};

function gpsHint(status: GpsStatus): string {
  switch (status) {
    case "acquiring":
      return "Acquiring GPS…";
    case "ok":
      return "GPS locked";
    case "denied":
      return "Location denied — tracking time only. Enable location to record distance.";
    case "unavailable":
      return "GPS unavailable — tracking time only.";
    default:
      return "";
  }
}

function gpsHintColor(status: GpsStatus): string {
  if (status === "denied" || status === "unavailable") return "var(--cp-danger)";
  if (status === "ok") return "var(--cp-accent)";
  return "var(--cp-text-muted)";
}
