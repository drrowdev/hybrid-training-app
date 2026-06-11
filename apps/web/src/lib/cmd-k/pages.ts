/**
 * Static catalog of top-level destinations under `/app/*`.
 *
 * Derived from a manual sweep of `apps/web/src/app/app/` `page.tsx`
 * routes. Deep / parametric routes (e.g. `/app/sessions/[id]`) are
 * intentionally excluded — they belong to the dynamic indices.
 */

import type { PaletteItem } from "./types";

export const STATIC_PAGES: PaletteItem[] = [
  { id: "page-today", kind: "page", title: "Today", subtitle: "Today's session + check-in", href: "/app", icon: "◉" },
  { id: "page-plan", kind: "page", title: "Plan", subtitle: "Calendar / Timeline / List", href: "/app/plan", icon: "▦" },
  { id: "page-plan-history", kind: "page", title: "Plan — History", subtitle: "Past + archived blocks", href: "/app/plan/history", icon: "▦" },
  { id: "page-plan-new", kind: "page", title: "Plan — New block", subtitle: "Run the block wizard", href: "/app/plan/new", icon: "＋" },
  { id: "page-program", kind: "page", title: "Start a program", subtitle: "Pick a program (5/3/1, …) and deploy", href: "/app/program", icon: "＋" },
  { id: "page-sessions", kind: "page", title: "Sessions", subtitle: "Logged sessions", href: "/app/sessions", icon: "▮" },
  { id: "page-sessions-new", kind: "page", title: "Sessions — New", subtitle: "Log a freestyle session", href: "/app/sessions/new", icon: "＋" },
  { id: "page-stats", kind: "page", title: "Stats — Overview", subtitle: "Cross-system summary", href: "/app/stats", icon: "▲" },
  { id: "page-stats-blocks", kind: "page", title: "Stats — Blocks", subtitle: "Block history + outcomes", href: "/app/stats/blocks", icon: "▲" },
  { id: "page-stats-adherence", kind: "page", title: "Stats — Consistency", subtitle: "Planned vs. logged adherence", href: "/app/stats/adherence", icon: "▲" },
  { id: "page-stats-engine", kind: "page", title: "Stats — Engine", subtitle: "Region freshness + engine internals", href: "/app/stats/engine", icon: "▲" },
  { id: "page-stats-prs", kind: "page", title: "Stats — PRs", subtitle: "Personal records", href: "/app/stats/prs", icon: "▲" },
  { id: "page-races", kind: "page", title: "Events", subtitle: "Races, comps, meets — priority events", href: "/app/races", icon: "◆" },
  { id: "page-freshness", kind: "page", title: "Freshness", subtitle: "Per-region recovery state", href: "/app/freshness", icon: "◐" },
  { id: "page-log", kind: "page", title: "Log", subtitle: "Jump to today's session", href: "/app/log", icon: "▮" },
  { id: "page-settings", kind: "page", title: "Settings", subtitle: "Profile, integrations, preferences", href: "/app/settings", icon: "⚙" },
  { id: "page-settings-events", kind: "page", title: "Settings — Events", subtitle: "Priority events + races", href: "/app/settings/events", icon: "⚙" },
  { id: "page-settings-limitations", kind: "page", title: "Settings — Limitations", subtitle: "Injuries + region limitations", href: "/app/settings/limitations", icon: "⚙" },
  { id: "page-settings-strava", kind: "page", title: "Settings — Strava", subtitle: "Strava integration", href: "/app/settings/strava", icon: "⚙" },
  { id: "page-settings-tms", kind: "page", title: "Settings — Training Maxes", subtitle: "Update TM values", href: "/app/settings/training-maxes", icon: "⚙" },
  { id: "page-settings-trash", kind: "page", title: "Settings — Trash", subtitle: "Restore or hard-delete", href: "/app/settings/trash", icon: "⚙" },
];
