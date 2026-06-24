/**
 * HYROX completion view-model (ADR 0050 step 7c, server side).
 *
 * Builds the props the client `HyroxCompletionForm` needs from a planned HYROX
 * session: the structured display rows, the loaded stations that need a confirm-
 * weight input (with division-standard defaults), and benchmark/division flags.
 * Pure given its inputs — the caller supplies the resolved HYROX instance + ref.
 */
import {
  hyroxSessionIdForRef,
  parseHyroxRef,
  stationFocusForWeek,
  getHyroxSession,
  getStation,
  stationLoadLabel,
  HYROX_STATIONS,
  type HyroxInstance,
} from "@hta/hyrox";
import { loadedStationsForSession } from "./materialize-actuals";
import type {
  HyroxStructureRow,
  HyroxLoadedStation,
} from "@/components/session/HyroxCompletionForm";

export interface HyroxCompletionView {
  hyroxSessionId: string;
  title: string;
  structure: HyroxStructureRow[];
  loadedStations: HyroxLoadedStation[];
  isBenchmark: boolean;
  divisionLabel: string;
}

const DIVISION_LABEL: Record<string, string> = {
  open: "Open division",
  pro: "Pro division",
  doubles: "Doubles",
};

function metersLabel(m: number): string {
  return m >= 1000 ? `${m / 1000} km` : `${m} m`;
}

/** The men's standard for a station+division, used to prefill the confirm-weight input. */
function defaultWeightKg(movementKey: string, division: string): number {
  const st = getStation(movementKey);
  const load = division === "pro" ? st?.pro : st?.open;
  return load?.men ?? 0;
}

/** Build the structured display rows for a session id (engine-defined). */
function buildStructure(hyroxSessionId: string, performedMovements?: readonly string[]): HyroxStructureRow[] {
  const sess = getHyroxSession(hyroxSessionId);
  if (!sess) return [];

  if (sess.category === "sim") {
    const count = hyroxSessionId === "sim-half" ? 4 : 8;
    const rows: HyroxStructureRow[] = [];
    for (let i = 0; i < count; i++) {
      rows.push({ name: "Run", detail: i === 0 ? "race effort" : "compromised", amount: "1 km" });
      const st = HYROX_STATIONS[i];
      if (st) {
        rows.push({
          name: st.name,
          detail: st.note,
          amount: st.distanceM != null ? metersLabel(st.distanceM) : st.reps != null ? `${st.reps} reps` : undefined,
        });
      }
    }
    return rows;
  }

  if (sess.category === "run" || sess.category === "erg") {
    return [{ name: sess.name, detail: sess.note }];
  }

  // intervals / circuit / compromised — a rounds summary + the involved stations.
  // For the focused rotation (ADR 0062) only the week's focused stations are shown.
  const rows: HyroxStructureRow[] = [{ name: sess.name, detail: sess.note }];
  for (const key of performedMovements ?? sess.movements) {
    const st = getStation(key);
    if (!st) continue;
    rows.push({
      name: st.name,
      amount: st.distanceM != null ? metersLabel(st.distanceM) : st.reps != null ? `${st.reps} reps` : undefined,
    });
  }
  return rows;
}

/**
 * Build the completion view for a HYROX planned session, or null when the ref
 * doesn't resolve to a structured (non-strength) HYROX session.
 */
export function buildHyroxCompletionView(
  instance: HyroxInstance,
  programRef: string,
): HyroxCompletionView | null {
  const hyroxSessionId = hyroxSessionIdForRef(instance, programRef);
  if (!hyroxSessionId) return null;
  const sess = getHyroxSession(hyroxSessionId);
  if (!sess || sess.category === "strength") return null;

  const division = instance.division;
  // Focused station rotation (ADR 0062): only confirm weights for the stations
  // ACTUALLY in this week's focused subset, not the session's full static list —
  // otherwise the form would ask for sled weights on a week that only rows + wall
  // balls. vo2-intervals / non-rotating sessions fall back to their full list.
  const week = parseHyroxRef(programRef)?.week ?? 1;
  const focusedMovements = stationFocusForWeek(hyroxSessionId, week, sess.movements).movements;
  const focusedKeys = new Set(focusedMovements);
  const loadedStations: HyroxLoadedStation[] = loadedStationsForSession(hyroxSessionId)
    .filter(({ key }) => focusedKeys.has(key))
    .map(({ key }) => {
      const st = getStation(key);
      return {
        key,
        name: st?.name ?? key,
        defaultKg: defaultWeightKg(key, division),
        loadLabel: st ? stationLoadLabel(st, division) : "",
        ...(st?.distanceM != null
          ? { amount: metersLabel(st.distanceM) }
          : st?.reps != null
            ? { amount: `${st.reps} reps` }
            : {}),
      };
    });

  return {
    hyroxSessionId,
    title: sess.name,
    structure: buildStructure(hyroxSessionId, focusedMovements),
    loadedStations,
    isBenchmark: sess.category === "sim",
    divisionLabel: DIVISION_LABEL[division] ?? "Open division",
  };
}
