"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  resolveDateFormat,
  resolveTimeFormat,
  type DateFormat,
  type TimeFormat,
} from "@/lib/format/datetime";
import { updateDateTimeFormat } from "@/lib/settings/format-actions";

type Props = {
  initialTimeFormat: TimeFormat | null;
  initialDateFormat: DateFormat | null;
  resolvedTimeFormat: TimeFormat;
  resolvedDateFormat: DateFormat;
};

// Detect the browser's IANA timezone via useSyncExternalStore so the
// initial SSR render emits an empty string (matching the server) and
// the post-hydration value comes from `Intl.DateTimeFormat`. Avoids
// the "setState in effect" lint rule (and the cascading-render hazard
// it points at) by computing the snapshot synchronously on the client.
function getClientTimezoneSnapshot(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" ? tz : "";
  } catch {
    return "";
  }
}
function getServerTimezoneSnapshot(): string {
  return "";
}
function subscribe() {
  // The detected timezone doesn't change while the page is mounted —
  // no event source to subscribe to. A no-op unsubscribe is fine.
  return () => {};
}

/**
 * "Time & date format" settings card. Two selects with live examples
 * next to the dropdown. A blank/`auto` value clears the column so the
 * timezone-derived locale default applies.
 */
export function DateTimeFormatCard({
  initialTimeFormat,
  initialDateFormat,
  resolvedTimeFormat,
  resolvedDateFormat,
}: Props) {
  const [timeFormat, setTimeFormat] = useState<TimeFormat | "auto">(
    initialTimeFormat ?? "auto",
  );
  const [dateFormat, setDateFormat] = useState<DateFormat | "auto">(
    initialDateFormat ?? "auto",
  );

  // Detect the browser's IANA timezone once on mount. SSR-safe — the
  // initial render emits an empty string (matching server output), and
  // the post-hydration store value comes from `Intl.DateTimeFormat` so
  // the "Auto" preview can resolve against the user's actual region
  // even when `profile.timezone` is still NULL.
  const clientTimezone = useSyncExternalStore(
    subscribe,
    getClientTimezoneSnapshot,
    getServerTimezoneSnapshot,
  );

  const timeExample = useMemo(() => {
    let id: TimeFormat;
    if (timeFormat === "auto") {
      // When the user hasn't picked an explicit format yet, prefer the
      // browser-detected timezone over the (possibly NULL) profile one
      // so the preview matches what the save will produce.
      id = clientTimezone
        ? resolveTimeFormat({ timezone: clientTimezone })
        : resolvedTimeFormat;
    } else {
      id = timeFormat;
    }
    return TIME_FORMAT_OPTIONS.find((o) => o.id === id)?.example ?? "";
  }, [timeFormat, resolvedTimeFormat, clientTimezone]);

  const dateExample = useMemo(() => {
    let id: DateFormat;
    if (dateFormat === "auto") {
      id = clientTimezone
        ? resolveDateFormat({ timezone: clientTimezone })
        : resolvedDateFormat;
    } else {
      id = dateFormat;
    }
    return DATE_FORMAT_OPTIONS.find((o) => o.id === id)?.example ?? "";
  }, [dateFormat, resolvedDateFormat, clientTimezone]);

  return (
    <form
      action={updateDateTimeFormat}
      className="space-y-4 rounded-lg border border-foreground/10 p-4"
      data-testid="settings-datetime-format-form"
    >
      <div className="space-y-1">
        <label className="text-xs text-foreground/60" htmlFor="timeFormat">
          Time
        </label>
        <div className="flex items-center gap-3">
          <select
            id="timeFormat"
            name="timeFormat"
            data-testid="settings-time-format-select"
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value as TimeFormat | "auto")}
            className="flex-1 rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
          >
            <option value="auto">Auto (from timezone)</option>
            {TIME_FORMAT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span
            data-testid="settings-time-format-example"
            className="text-xs font-mono text-foreground/60 min-w-[6ch] text-right"
          >
            {timeExample}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-foreground/60" htmlFor="dateFormat">
          Date
        </label>
        <div className="flex items-center gap-3">
          <select
            id="dateFormat"
            name="dateFormat"
            data-testid="settings-date-format-select"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value as DateFormat | "auto")}
            className="flex-1 rounded-md border border-foreground/15 bg-transparent px-2 py-2 text-sm"
          >
            <option value="auto">Auto (from timezone)</option>
            {DATE_FORMAT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span
            data-testid="settings-date-format-example"
            className="text-xs font-mono text-foreground/60 min-w-[12ch] text-right"
          >
            {dateExample}
          </span>
        </div>
      </div>

      <button
        type="submit"
        data-testid="settings-datetime-format-save"
        className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
      >
        Save formats
      </button>

      <input
        type="hidden"
        name="detectedTimezone"
        data-testid="settings-datetime-detected-timezone"
        value={clientTimezone}
      />

      <p className="text-xs text-foreground/50">
        Auto picks 24-hour + DD/MM/YYYY in Europe, 12-hour + MM/DD/YYYY in
        the Americas, and 24-hour + ISO elsewhere — based on your timezone.
        If your timezone isn&apos;t set, we use your browser&apos;s detected
        timezone instead. Pick an explicit option to override.
      </p>
    </form>
  );
}
