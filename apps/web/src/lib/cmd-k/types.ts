/**
 * Quick-jump command palette — shared item shape.
 *
 * Every searchable entry (page, movement, block, session, event) flows
 * through this single union so the client palette can rank + render all
 * indices uniformly.
 */

export type PaletteKind =
  | "page"
  | "movement"
  | "block"
  | "session"
  | "event";

export type PaletteItem = {
  id: string;
  kind: PaletteKind;
  title: string;
  subtitle?: string;
  href: string;
  /** Small glyph rendered to the left of the title — purely decorative. */
  icon?: string;
};

/**
 * Pre-loaded indices passed from `app/layout.tsx` (server) into the
 * client palette on first mount. Small enough (<100 rows total) that
 * we hand the whole thing to the browser and filter in-memory rather
 * than round-tripping per keystroke.
 */
export type PaletteIndices = {
  pages: PaletteItem[];
  movements: PaletteItem[];
  blocks: PaletteItem[];
  sessions: PaletteItem[];
  events: PaletteItem[];
};

/** Section labels rendered above each grouped result block. */
export const KIND_LABEL: Record<PaletteKind, string> = {
  page: "Pages",
  movement: "Movements",
  block: "Blocks",
  session: "Sessions",
  event: "Events",
};

/**
 * Order section groups appear in the rendered list. Mirrors the kind
 * boost in the matcher (pages first, events last).
 */
export const KIND_ORDER: PaletteKind[] = [
  "page",
  "session",
  "block",
  "movement",
  "event",
];
