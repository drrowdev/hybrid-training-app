/**
 * Minimal in-memory Supabase shim for unit tests.
 *
 * Implements the chainable PostgREST query builder pattern used by
 * `lib/stats/blocks.ts` against plain-object fixture tables. Only the
 * filters / modifiers actually called in that module are supported —
 * if a future helper needs a new operator (e.g. `.like`) it should be
 * added here.
 *
 * The shape intentionally mirrors PostgREST closely so the production
 * code path is unchanged. Tests pass fixture tables in via
 * `makeFakeSupabase({ training_blocks: [...], ... })`.
 *
 * Join handling: `select` strings that include `table!inner(cols)` are
 * resolved against the fake `sessions` / `training_blocks` tables — a
 * row only survives the join if a matching row exists AND the join's
 * filters (`!inner` conditions like `sessions.user_id = X`) match. The
 * filters chained after a join (`q.eq("sessions.user_id", userId)`)
 * are routed to the join target by detecting the dotted column name.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export type Tables = {
  training_blocks: Row[];
  planned_sessions: Row[];
  sessions: Row[];
  set_logs: Row[];
  movements: Row[];
  wellness: Row[];
  profiles: Row[];
};

type Filter =
  | { op: "eq"; column: string; value: unknown }
  | { op: "neq"; column: string; value: unknown }
  | { op: "in"; column: string; values: unknown[] }
  | { op: "is"; column: string; value: null }
  | { op: "not-is"; column: string; value: null }
  | { op: "gt"; column: string; value: unknown }
  | { op: "gte"; column: string; value: unknown }
  | { op: "lt"; column: string; value: unknown }
  | { op: "lte"; column: string; value: unknown };

type JoinSpec = {
  table: keyof Tables;
  alias: string;
  inner: boolean;
  columns: string[];
};

type QueryState = {
  table: keyof Tables;
  selectCols: string[];
  joins: JoinSpec[];
  filters: Filter[];
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
  range: { from: number; to: number } | null;
  single: "single" | "maybeSingle" | null;
};

export function makeFakeSupabase(tables: Tables): SupabaseClient {
  function from(table: keyof Tables) {
    const state: QueryState = {
      table,
      selectCols: [],
      joins: [],
      filters: [],
      order: null,
      limit: null,
      range: null,
      single: null,
    };
    return buildQuery(state, tables);
  }
  return { from } as unknown as SupabaseClient;
}

function buildQuery(state: QueryState, tables: Tables) {
  const q = {
    select(cols: string) {
      const { topLevel, joins } = parseSelect(cols);
      state.selectCols = topLevel;
      state.joins = joins;
      return q;
    },
    eq(column: string, value: unknown) {
      state.filters.push({ op: "eq", column, value });
      return q;
    },
    neq(column: string, value: unknown) {
      state.filters.push({ op: "neq", column, value });
      return q;
    },
    in(column: string, values: unknown[]) {
      state.filters.push({ op: "in", column, values });
      return q;
    },
    is(column: string, value: null) {
      state.filters.push({ op: "is", column, value });
      return q;
    },
    not(column: string, op: string, value: unknown) {
      if (op === "is" && value === null) {
        state.filters.push({ op: "not-is", column, value: null });
      }
      return q;
    },
    gt(column: string, value: unknown) {
      state.filters.push({ op: "gt", column, value });
      return q;
    },
    gte(column: string, value: unknown) {
      state.filters.push({ op: "gte", column, value });
      return q;
    },
    lt(column: string, value: unknown) {
      state.filters.push({ op: "lt", column, value });
      return q;
    },
    lte(column: string, value: unknown) {
      state.filters.push({ op: "lte", column, value });
      return q;
    },
    order(column: string, opts?: { ascending?: boolean }) {
      state.order = { column, ascending: opts?.ascending ?? true };
      return q;
    },
    limit(n: number) {
      state.limit = n;
      return q;
    },
    range(from: number, to: number) {
      state.range = { from, to };
      return q;
    },
    single() {
      state.single = "single";
      return runQuery(state, tables);
    },
    maybeSingle() {
      state.single = "maybeSingle";
      return runQuery(state, tables);
    },
    then(onFulfilled: (value: { data: Row[] | Row | null; error: null }) => unknown) {
      return runQuery(state, tables).then(onFulfilled);
    },
  };
  return q;
}

function parseSelect(spec: string): { topLevel: string[]; joins: JoinSpec[] } {
  // Strip whitespace.
  const s = spec.replace(/\s+/g, "");
  const topLevel: string[] = [];
  const joins: JoinSpec[] = [];

  let depth = 0;
  let buf = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "(") {
      depth++;
      buf += ch;
    } else if (ch === ")") {
      depth--;
      buf += ch;
    } else if (ch === "," && depth === 0) {
      pushPart(buf, topLevel, joins);
      buf = "";
    } else {
      buf += ch;
    }
    i++;
  }
  if (buf.length > 0) pushPart(buf, topLevel, joins);
  return { topLevel, joins };
}

function pushPart(part: string, topLevel: string[], joins: JoinSpec[]) {
  // Forms: "col", "alias:col", "table(cols)", "table!inner(cols)",
  // "alias:table(cols)".
  const parenIdx = part.indexOf("(");
  if (parenIdx === -1) {
    topLevel.push(part);
    return;
  }
  const head = part.slice(0, parenIdx);
  const body = part.slice(parenIdx + 1, part.length - 1);
  const innerSplit = head.split("!");
  const inner = innerSplit[1] === "inner";
  const aliasSplit = innerSplit[0].split(":");
  const alias = aliasSplit.length === 2 ? aliasSplit[0]! : innerSplit[0]!;
  const tableName = aliasSplit.length === 2 ? aliasSplit[1]! : innerSplit[0]!;
  joins.push({
    table: tableName as keyof Tables,
    alias,
    inner,
    columns: body.split(",").filter(Boolean),
  });
}

async function runQuery(state: QueryState, tables: Tables): Promise<{ data: Row[] | Row | null; error: null }> {
  let rows = (tables[state.table] ?? []).slice();

  // Apply filters bucketed by target (top-level vs join target).
  const topFilters: Filter[] = [];
  const joinFilters = new Map<string, Filter[]>();
  for (const f of state.filters) {
    const dot = f.column.indexOf(".");
    if (dot !== -1) {
      const target = f.column.slice(0, dot);
      const col = f.column.slice(dot + 1);
      const list = joinFilters.get(target) ?? [];
      list.push({ ...f, column: col } as Filter);
      joinFilters.set(target, list);
    } else {
      topFilters.push(f);
    }
  }

  rows = rows.filter((r) => topFilters.every((f) => matchFilter(r, f)));

  // Process joins: for each row, try to resolve every join. Inner
  // joins drop the row if no match. The joined row data is attached
  // back onto the parent row under the join alias.
  if (state.joins.length > 0) {
    rows = rows
      .map((r) => {
        const parent = { ...r };
        for (const j of state.joins) {
          const candidates = (tables[j.table] ?? []).filter((joinRow) =>
            (joinFilters.get(j.alias) ?? []).every((f) => matchFilter(joinRow, f)),
          );
          // Pick rows whose join key matches the parent. Convention:
          // parent's `<table>_id` column (singular) holds the FK, OR
          // join row's `id` matches parent's `<alias>_id`, OR for the
          // session→training_blocks join via planned_sessions we
          // match `block_id` to `training_blocks.id`.
          const match = candidates.find((joinRow) => fkMatch(parent, joinRow, j));
          if (j.inner && !match) return null;
          // Project only the requested columns from the joined row.
          if (match) {
            const projected: Row = {};
            for (const col of j.columns) {
              if (col === "*") {
                Object.assign(projected, match);
              } else {
                projected[col] = match[col];
              }
            }
            parent[j.alias] = projected;
          } else {
            parent[j.alias] = null;
          }
        }
        return parent;
      })
      .filter((r): r is Row => r != null);
  }

  // Project (optional): keep all columns when select had wildcards/
  // joins; the production code reads what it asked for anyway, so
  // returning extra columns is harmless.

  // Order.
  if (state.order) {
    const { column, ascending } = state.order;
    rows.sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return ascending ? -1 : 1;
      if (av > bv) return ascending ? 1 : -1;
      return 0;
    });
  }

  // Range / limit.
  if (state.range) {
    rows = rows.slice(state.range.from, state.range.to + 1);
  } else if (state.limit != null) {
    rows = rows.slice(0, state.limit);
  }

  if (state.single === "single") {
    return { data: rows[0] ?? null, error: null };
  }
  if (state.single === "maybeSingle") {
    return { data: rows[0] ?? null, error: null };
  }
  return { data: rows, error: null };
}

function matchFilter(row: Row, f: Filter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case "eq":
      return v === f.value;
    case "neq":
      return v !== f.value;
    case "in":
      return f.values.includes(v);
    case "is":
      return v == null;
    case "not-is":
      return v != null;
    case "gt":
      return v != null && (v as number) > (f.value as number);
    case "gte":
      return v != null && (v as number) >= (f.value as number);
    case "lt":
      return v != null && (v as number) < (f.value as number);
    case "lte":
      return v != null && (v as number) <= (f.value as number);
  }
}

// Singular forms used by PostgREST `<singular>_id` FK naming.
const SINGULAR: Record<string, string> = {
  sessions: "session",
  movements: "movement",
  training_blocks: "block",
  planned_sessions: "planned_session",
  set_logs: "set_log",
  wellness: "wellness",
  profiles: "profile",
};

function fkMatch(parent: Row, joinRow: Row, j: JoinSpec): boolean {
  // Common conventions:
  //   parent.<singular(table)>_id === joinRow.id  (PostgREST default)
  //   parent.<alias>_id            === joinRow.id  (when alias differs)
  const singular = SINGULAR[j.table] ?? j.table;
  const candidates = [
    [`${singular}_id`, "id"],
    [`${j.alias}_id`, "id"],
  ];
  for (const [pCol, jCol] of candidates) {
    if (parent[pCol] != null && joinRow[jCol] != null && parent[pCol] === joinRow[jCol]) {
      return true;
    }
  }
  // Special case: planned_sessions.completed_session_id → sessions.id
  if (
    j.table === "sessions" &&
    parent.completed_session_id != null &&
    parent.completed_session_id === joinRow.id
  ) {
    return true;
  }
  return false;
}
