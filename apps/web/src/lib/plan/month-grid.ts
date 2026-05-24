/**
 * Pure helpers for the Month view grid.
 *
 * `monthGridCells(year, month)` returns the exact 42-cell sequence
 * (6 weeks × Mon→Sun) that the grid renders. Days from the previous
 * and next month are emitted with `inMonth: false` so the view can
 * mute them. The grid is anchored on Monday — to match every other
 * weekly artifact in the app (heatmap, planner DOW labels, etc.).
 */

export type MonthGridCell = {
  /** YYYY-MM-DD. */
  date: string;
  /** Day-of-month number (1–31). */
  day: number;
  /** True when this cell belongs to (year, month). */
  inMonth: boolean;
};

/**
 * Build a 6-row × 7-col Monday-first grid covering (year, month).
 * Pads the leading and trailing weeks with neighbouring-month days so
 * the rendered shape is always exactly 42 cells.
 *
 * Example: May 2026 (1 May = Friday) → 4 trailing days of April + the
 * 31 May days + 1 leading day of June = 36. We then pad the bottom
 * row with 6 days of June so the grid reads as a clean 6-week block.
 */
export function monthGridCells(year: number, month: number): MonthGridCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // Mon = 0 … Sun = 6.
  const firstWeekday = (first.getUTCDay() + 6) % 7;
  // Start cell = the Monday on/before the 1st.
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - firstWeekday);

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    cells.push({
      date: ymdUtc(d),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1 && d.getUTCFullYear() === year,
    });
  }
  return cells;
}

function ymdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Parse a YYYY-MM(-DD?) anchor into a (year, month) pair. Used by the
 * page to decode `?date=` into the month the grid renders.
 */
export function parseMonthAnchor(anchor: string | undefined, fallbackToday: string): { year: number; month: number } {
  const src = anchor && /^\d{4}-\d{2}/.test(anchor) ? anchor : fallbackToday;
  const year = Number.parseInt(src.slice(0, 4), 10);
  const month = Number.parseInt(src.slice(5, 7), 10);
  return { year, month };
}

/**
 * Prev/next month anchors as YYYY-MM-DD (always the 1st), for the
 * grid's header navigation.
 */
export function monthShift(year: number, month: number, delta: number): string {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return ymdUtc(d);
}
