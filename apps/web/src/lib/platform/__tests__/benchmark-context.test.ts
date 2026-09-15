import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildPlatformContext } from "../context";
import { trainingMaxEditsSchema } from "../../training-maxes/input";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const movements = [
  { id: id(1), slug: "back-squat-high-bar", display_name: "Back Squat" },
  { id: id(2), slug: "bench-press-flat", display_name: "Bench Press" },
];

function fixture() {
  const requests: { method: string; url: URL }[] = [];
  const stored = [{ one_rm_kg: 100, movement: movements[0] }];
  const client = createClient("https://benchmark.test", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      requests.push({ method: init?.method ?? "GET", url });
      if (url.pathname.endsWith("profiles")) return Response.json({ warmup_scheme: null, bodyweight_kg: 80 });
      if (url.pathname.endsWith("training_maxes")) return Response.json(stored);
      if (url.pathname.endsWith("movements")) return Response.json(movements);
      throw new Error("Unexpected synthetic request");
    } },
  });
  return { client, requests, stored };
}

describe("DC-SW8 read-only programme benchmark preparation", () => {
  it("uses edited and new benchmarks without writing them before programme fit", async () => {
    const { client, requests, stored } = fixture();
    const bundle = await buildPlatformContext(client, id(9), {
      benchmarkEdits: [{ movementId: id(1), oneRmKg: 120 }, { movementId: id(2), oneRmKg: 85 }],
    });
    expect(bundle.ctx.oneRepMaxes.squat).toBe(120);
    expect(bundle.ctx.oneRepMaxes.bench).toBe(85);
    expect(stored[0]?.one_rm_kg).toBe(100);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(requests.find((request) => request.url.pathname.endsWith("movements") && request.url.searchParams.has("id"))?.url.searchParams.get("id"))
      .toBe(`in.(${id(1)},${id(2)})`);
  });

  it("rejects missing or inaccessible movements instead of silently dropping an edit", async () => {
    const { client, requests } = fixture();
    await expect(buildPlatformContext(client, id(9), {
      benchmarkEdits: [{ movementId: id(3), oneRmKg: 120 }],
    })).rejects.toThrow("no longer available");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("keeps the existing context unchanged when there are no benchmark edits", async () => {
    const { client, requests } = fixture();
    const bundle = await buildPlatformContext(client, id(9));
    expect(bundle.ctx.oneRepMaxes.squat).toBe(100);
    expect(requests.some((request) => request.url.pathname.endsWith("movements") && request.url.searchParams.has("id"))).toBe(false);
  });

  it("bounds input and rejects duplicates and extra authority fields", () => {
    expect(trainingMaxEditsSchema.safeParse([{ movementId: id(1), oneRmKg: 100 }]).success).toBe(true);
    for (const input of [
      [{ movementId: id(1), oneRmKg: 0 }],
      [{ movementId: id(1), oneRmKg: 1001 }],
      [{ movementId: id(1), oneRmKg: true }],
      [{ movementId: id(1), oneRmKg: "120" }],
      [{ movementId: id(1), oneRmKg: 100, userId: id(9) }],
      [{ movementId: id(1), oneRmKg: 100 }, { movementId: id(1), oneRmKg: 110 }],
    ]) expect(trainingMaxEditsSchema.safeParse(input).success).toBe(false);
  });
});
