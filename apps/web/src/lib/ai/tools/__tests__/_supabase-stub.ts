/**
 * Lightweight Supabase query-chain stub for catalogue tool tests.
 *
 * Mirrors the chain methods our tool handlers call (.from/.select/.eq/
 * .gte/.lte/.is/.not/.gt/.neq/.in/.order/.limit/.maybeSingle/await).
 * Each call returns the queryable so chained calls keep working.
 *
 * The factory is keyed by table name so a single stub can serve
 * multiple `from(...)` calls per test.
 */
import { vi, type Mock } from "vitest";

export type StubRow = Record<string, unknown>;

export type RlsFilter = (row: StubRow, ctx: { userId: string }) => boolean;

export type StubTable = {
  rows: StubRow[];
  /**
   * Optional row filter that mimics RLS. The default filter requires
   * `row.user_id === ctx.userId` when the row has a `user_id`.
   */
  rlsFilter?: RlsFilter;
};

export type StubOptions = {
  userId: string;
  tables: Record<string, StubTable | StubRow[]>;
};

function defaultRlsFilter(row: StubRow, ctx: { userId: string }): boolean {
  if ("user_id" in row) return row.user_id === ctx.userId;
  // Some tables (e.g. `profiles`) key on `id` instead of `user_id` so
  // the production RLS policy uses `id = auth.uid()`. Mirror that when
  // an `id` field is present.
  if ("id" in row) return row.id === ctx.userId;
  return true;
}

function applyRls(
  rows: StubRow[],
  rls: RlsFilter | undefined,
  userId: string,
): StubRow[] {
  const f = rls ?? defaultRlsFilter;
  return rows.filter((r) => f(r, { userId }));
}

export function createSupabaseStub(opts: StubOptions): {
  client: {
    from: (table: string) => unknown;
  };
  fromCalls: Mock;
} {
  const fromCalls = vi.fn();

  const client = {
    from(table: string) {
      fromCalls(table);
      const raw = opts.tables[table];
      const normalised: StubTable =
        raw && "rows" in (raw as object) && Array.isArray((raw as StubTable).rows)
          ? (raw as StubTable)
          : { rows: (raw as StubRow[] | undefined) ?? [] };

      const visible = applyRls(
        normalised.rows,
        normalised.rlsFilter,
        opts.userId,
      );

      type Q = {
        select: (...args: unknown[]) => Q;
        eq: (...args: unknown[]) => Q;
        gte: (...args: unknown[]) => Q;
        lte: (...args: unknown[]) => Q;
        is: (...args: unknown[]) => Q;
        not: (...args: unknown[]) => Q;
        gt: (...args: unknown[]) => Q;
        neq: (...args: unknown[]) => Q;
        in: (...args: unknown[]) => Q;
        order: (...args: unknown[]) => Q;
        limit: (...args: unknown[]) => Q;
        maybeSingle: () => Promise<{ data: StubRow | null }>;
        then: (
          resolve: (v: { data: StubRow[] }) => void,
        ) => Promise<void>;
      };
      const q: Q = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        lte: () => q,
        is: () => q,
        not: () => q,
        gt: () => q,
        neq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: visible[0] ?? null }),
        then: (resolve) =>
          Promise.resolve({ data: visible }).then(resolve),
      };
      return q;
    },
  };

  return { client, fromCalls };
}
