"use server";

import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  buildMovementHistory,
  type HistoryCardioEntry,
  type HistorySessionInfo,
  type HistorySetEntry,
  type MovementHistory,
} from "./movement-history";

const SET_ROW_CAP = 600;
const CARDIO_ROW_CAP = 200;

type SessionJoin = (HistorySessionInfo & { user_id: string; deleted_at: string | null });
type Joined<T> = T & { sessions: SessionJoin | SessionJoin[] | null };

const one = (value: SessionJoin | SessionJoin[] | null): HistorySessionInfo | null => {
  const row = Array.isArray(value) ? value[0] : value;
  return row ? { id: row.id, title: row.title, performed_at: row.performed_at } : null;
};
const num = (value: number | string | null): number | null => (value == null ? null : Number(value));

/**
 * Every earlier logged set (and cardio block) of one movement, newest session
 * first. Warm-ups are excluded; skipped sets are kept. The caller's own
 * session is left out: its sets are already on screen.
 */
export async function getMovementHistory(
  movementId: string,
  excludeSessionId?: string,
): Promise<{ ok: true; history: MovementHistory } | { ok: false; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(movementId)) return { ok: false, error: "Couldn't load history." };
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const [setResult, cardioResult] = await Promise.all([
    supabase
      .from("set_logs")
      .select(
        "id, set_index, set_kind, weight_kg, reps, duration_sec, distance_m, rpe, notes, skipped, skip_reason, created_at, sessions!inner(id, title, performed_at, user_id, deleted_at)",
      )
      .eq("movement_id", movementId)
      .eq("sessions.user_id", user.id)
      .is("sessions.deleted_at", null)
      .neq("set_kind", "warmup")
      .order("created_at", { ascending: false })
      .limit(SET_ROW_CAP),
    supabase
      .from("cardio_logs")
      .select(
        "id, duration_sec, distance_km, rpe, notes, created_at, sessions!inner(id, title, performed_at, user_id, deleted_at)",
      )
      .eq("movement_id", movementId)
      .eq("sessions.user_id", user.id)
      .is("sessions.deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(CARDIO_ROW_CAP),
  ]);
  if (setResult.error || cardioResult.error) return { ok: false, error: "Couldn't load history." };

  type SetRow = Joined<{
    id: string; set_index: number; weight_kg: number | string | null; reps: number | null;
    duration_sec: number | null; distance_m: number | null; rpe: number | string | null; notes: string | null;
    skipped: boolean; skip_reason: string | null; created_at: string;
  }>;
  type CardioRow = Joined<{
    id: string; duration_sec: number | null; distance_km: number | string | null;
    rpe: number | string | null; notes: string | null; created_at: string;
  }>;

  const sets = (setResult.data as unknown as SetRow[]).flatMap((row) => {
    const session = one(row.sessions);
    if (!session || session.id === excludeSessionId) return [];
    const entry: HistorySetEntry = {
      kind: "set", id: row.id, setIndex: row.set_index, createdAt: row.created_at,
      weightKg: num(row.weight_kg), reps: row.reps, durationSec: row.duration_sec, distanceM: row.distance_m,
      rpe: num(row.rpe), notes: row.notes, skipped: row.skipped, skipReason: row.skip_reason,
    };
    return [{ session, entry }];
  });
  const cardio = (cardioResult.data as unknown as CardioRow[]).flatMap((row) => {
    const session = one(row.sessions);
    if (!session || session.id === excludeSessionId) return [];
    const entry: HistoryCardioEntry = {
      kind: "cardio", id: row.id, createdAt: row.created_at, durationSec: row.duration_sec,
      distanceKm: num(row.distance_km), rpe: num(row.rpe), notes: row.notes,
    };
    return [{ session, entry }];
  });

  return {
    ok: true,
    history: buildMovementHistory(sets, cardio,
      setResult.data.length >= SET_ROW_CAP || cardioResult.data.length >= CARDIO_ROW_CAP),
  };
}
