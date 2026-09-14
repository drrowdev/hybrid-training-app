import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { poolCourse } from "@hta/domain";
import { swimPoolEditingAvailable, swimPoolEditContext } from "../pool-editing";
import { swimFixture } from "./fixtures";

afterEach(() => vi.unstubAllEnvs());

describe("DC-SW5 pool editing capability and scope", () => {
  function client(response: Response) {
    const fetch = vi.fn(async () => response);
    return {
      fetch, client: createClient("http://127.0.0.1:54321", "synthetic-test-key", {
        auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
      }),
    };
  }
  it("does not probe or enable the default-off feature", async () => {
    vi.stubEnv("SWIM_POOL_EDITING_ENABLED", "");
    const fixture = client(new Response("true"));
    expect(await swimPoolEditingAvailable(fixture.client)).toBe(false);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("requires the exact ready response when enabled", async () => {
    vi.stubEnv("SWIM_POOL_EDITING_ENABLED", "true");
    const ready = client(new Response("true", { headers: { "content-type": "application/json" } }));
    expect(await swimPoolEditingAvailable(ready.client)).toBe(true);
    expect(ready.fetch).toHaveBeenCalledOnce();
    for (const response of [
      new Response("false", { headers: { "content-type": "application/json" } }),
      new Response('{"code":"PGRST202","message":"Synthetic unavailable function"}', { status: 404 }),
    ]) await expect(swimPoolEditingAvailable(client(response).client)).rejects.toBeInstanceOf(Error);
  });
  it("exposes today's unstarted swim but not settled work", () => {
    const { plan, workouts } = swimFixture({ course: poolCourse(50, 1, "m") });
    const workout = workouts[0]!;
    const changed = { ...plan, state: { ...plan.state, poolCourse: poolCourse(25, 1, "m") } };
    expect(swimPoolEditContext(changed, workout.scheduled_date, workout)).toMatchObject({
      defaultCourse: poolCourse(25, 1, "m"), workout: { course: poolCourse(50, 1, "m") },
    });
    expect(swimPoolEditContext(changed, "2026-09-08", workout)).toBeUndefined();
    expect(swimPoolEditContext(changed, "2026-09-05", { ...workout, status: "started" })).toBeUndefined();
    expect(swimPoolEditContext({ ...changed, status: "archived" }, "2026-09-05")).toBeUndefined();
  });
});
