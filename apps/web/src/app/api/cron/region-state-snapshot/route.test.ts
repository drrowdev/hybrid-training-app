/**
 * Unit tests for /api/cron/region-state-snapshot.
 *
 *  - 401 when the bearer is missing / wrong.
 *  - 200 + correct snapshot upsert payload when authorised.
 *  - Continues past per-user errors instead of bailing the batch.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type UpsertCall = { table: string; rows: unknown[]; opts: unknown };

const upsertCalls: UpsertCall[] = [];
let upsertShouldErrorFor: string | null = null;

const fakeAdmin = {
  auth: {
    admin: {
      listUsers: vi.fn(async (_opts: { page: number; perPage: number }) => ({
        data: { users: [{ id: "user-a" }, { id: "user-b" }] },
        error: null,
      })),
    },
  },
  from(table: string) {
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      in() {
        return this;
      },
      is() {
        return this;
      },
      not() {
        return this;
      },
      gt() {
        return this;
      },
      gte() {
        return this;
      },
      order() {
        return this;
      },
      // Region state — return a single seeded row so the live derivation
      // produces non-empty output.
      then(onF: (v: { data: unknown; error: null }) => unknown) {
        if (table === "region_state") {
          return Promise.resolve({
            data: [
              {
                region: "knee",
                atl: 0,
                ctl: 0,
                baseline_tolerance: 5,
                last_load_date: null,
              },
            ],
            error: null,
          }).then(onF);
        }
        return Promise.resolve({ data: [], error: null }).then(onF);
      },
      upsert(rows: unknown[], opts: unknown) {
        upsertCalls.push({ table, rows, opts });
        if (upsertShouldErrorFor && JSON.stringify(rows).includes(upsertShouldErrorFor)) {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createAdmin: () => fakeAdmin,
}));

import { GET } from "./route";

beforeEach(() => {
  upsertCalls.length = 0;
  upsertShouldErrorFor = null;
  process.env.CRON_SECRET = "test-secret";
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/region-state-snapshot", { headers });
}

describe("/api/cron/region-state-snapshot", () => {
  it("returns 401 without the bearer", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 401 with the wrong bearer", async () => {
    const res = await GET(req({ authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the right bearer and upserts a row per user×region", async () => {
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.users_processed).toBe(2);
    // Two users × one knee region each = two upserts (one per user).
    const knee = upsertCalls.filter((c) => c.table === "region_state_history");
    expect(knee).toHaveLength(2);
    // Each upsert payload uses ON CONFLICT on the composite key.
    expect(knee[0].opts).toEqual({ onConflict: "user_id,region,snapshot_date" });
    // Row shape includes the composite primary key + the context blob.
    const firstRow = (knee[0].rows as Array<Record<string, unknown>>)[0];
    expect(firstRow.user_id).toBe("user-a");
    expect(firstRow.region).toBe("knee");
    expect(firstRow.snapshot_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof firstRow.freshness_score).toBe("number");
    expect(firstRow.context).toMatchObject({
      sets_7d: expect.any(Number),
      sets_14d: expect.any(Number),
      sets_28d: expect.any(Number),
      atl: expect.any(Number),
      baseline: expect.any(Number),
    });
  });

  it("also upserts muscle_state_history snapshots alongside regions", async () => {
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.muscle_snapshots_written).toBe("number");
    // 16 muscles × 2 users = 32 expected snapshot rows.
    expect(body.muscle_snapshots_written).toBe(32);
    const muscle = upsertCalls.filter((c) => c.table === "muscle_state_history");
    expect(muscle).toHaveLength(2);
    expect(muscle[0].opts).toEqual({ onConflict: "user_id,muscle,snapshot_date" });
    const firstMuscleRow = (muscle[0].rows as Array<Record<string, unknown>>)[0];
    expect(firstMuscleRow.user_id).toBe("user-a");
    expect(typeof firstMuscleRow.muscle).toBe("string");
    expect(firstMuscleRow.snapshot_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof firstMuscleRow.freshness_score).toBe("number");
  });

  it("continues past per-user upsert errors", async () => {
    upsertShouldErrorFor = "user-a";
    const res = await GET(req({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // user-a fails on both the region and the muscle upsert; the
    // batch should record errors for both but keep going.
    expect(body.errors.length).toBeGreaterThanOrEqual(1);
    expect(body.errors.every((e: { userId: string }) => e.userId === "user-a")).toBe(true);
    // user-b still got upserted.
    expect(body.snapshots_written).toBeGreaterThan(0);
  });
});
