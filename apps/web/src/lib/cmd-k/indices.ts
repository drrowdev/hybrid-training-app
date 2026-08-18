/**
 * Server-side loaders for the quick-jump palette's dynamic indices.
 *
 * Called once per request from `app/layout.tsx`. Returns a small bundle
 * (≤100 rows total) of the user's movements, blocks, recent sessions,
 * and priority events — small enough to ship to the client and filter
 * in-memory rather than running a fresh query per keystroke.
 *
 * The static page catalog lives in `./pages.ts`; we merge it into the
 * returned bundle here so the layout has a single load call.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaletteIndices, PaletteItem } from "./types";
import { STATIC_PAGES } from "./pages";

const EMPTY_INDICES: PaletteIndices = {
  pages: STATIC_PAGES,
  movements: [],
  blocks: [],
  sessions: [],
  events: [],
};

/**
 * Best-effort cap. The matcher will still apply per-group caps; this
 * just keeps the layout payload from blowing up on power users with
 * thousands of movements.
 */
const MOVEMENT_LIMIT = 80;
const BLOCK_LIMIT = 30;
const SESSION_LIMIT = 20;
const EVENT_LIMIT = 30;

export async function loadPaletteIndices(
  supabase: SupabaseClient,
  userId: string,
): Promise<PaletteIndices> {
  if (!userId) return EMPTY_INDICES;

  // Each loader is independent — fan them out in parallel and tolerate
  // partial failures so a flaky table doesn't take the palette down.
  const [
    movementsRes,
    blocksRes,
    sessionsRes,
    eventsRes,
  ] = await Promise.allSettled([
    supabase
      .from("movements")
      // Global seed movements have user_id = null; user-owned customs
      // are scoped to the signed-in user.
      .select("id, slug, display_name, primary_region")
      .or(`user_id.is.null,user_id.eq.${userId}`)
      .order("display_name", { ascending: true })
      .limit(MOVEMENT_LIMIT),
    supabase
      .from("training_blocks")
      .select("id, archetype, started_on, ended_at, status")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("started_on", { ascending: false })
      .limit(BLOCK_LIMIT),
    supabase
      .from("sessions")
      .select("id, title, performed_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("performed_at", { ascending: false })
      .limit(SESSION_LIMIT),
    supabase
      .from("priority_events")
      .select("id, name, event_date, priority")
      .eq("user_id", userId)
      .order("event_date", { ascending: true })
      .limit(EVENT_LIMIT),
  ]);

  const movements: PaletteItem[] =
    movementsRes.status === "fulfilled" && movementsRes.value.data
      ? movementsRes.value.data.map((m) => ({
          id: `movement-${m.id}`,
          kind: "movement" as const,
          title: m.display_name as string,
          subtitle: m.primary_region as string,
          href: `/app/stats/movements/${m.slug}`,
          icon: "●",
        }))
      : [];

  const blocks: PaletteItem[] =
    blocksRes.status === "fulfilled" && blocksRes.value.data
      ? blocksRes.value.data.map((b) => {
          const archetype = (b.archetype as string) ?? "Block";
          const status = (b.status as string) ?? "active";
          const started = (b.started_on as string) ?? "";
          const ended = b.ended_at as string | null;
          const subtitle = ended
            ? `${status} · ${started}`
            : `${status} · started ${started}`;
          return {
            id: `block-${b.id}`,
            kind: "block" as const,
            title: archetype,
            subtitle,
            href: `/app/stats/blocks/${b.id}`,
            icon: "▦",
          };
        })
      : [];

  const sessions: PaletteItem[] =
    sessionsRes.status === "fulfilled" && sessionsRes.value.data
      ? sessionsRes.value.data.map((s) => {
          const performed = s.performed_at as string | null;
          const ymd = performed ? performed.slice(0, 10) : "";
          return {
            id: `session-${s.id}`,
            kind: "session" as const,
            title: (s.title as string) ?? "Session",
            subtitle: ymd || undefined,
            href: `/app/sessions/${s.id}`,
            icon: "▮",
          };
        })
      : [];

  const events: PaletteItem[] =
    eventsRes.status === "fulfilled" && eventsRes.value.data
      ? eventsRes.value.data.map((e) => ({
          id: `event-${e.id}`,
          kind: "event" as const,
          title: e.name as string,
          subtitle: `${e.priority ?? "A"}-priority · ${e.event_date}`,
          // Priority events live at /app/settings/events; the palette
          // deep-links into the row anchor so the row mounts expanded.
          href: `/app/settings/events#event-${e.id}`,
          icon: "★",
        }))
      : [];

  return {
    pages: STATIC_PAGES,
    movements,
    blocks,
    sessions,
    events,
  };
}
