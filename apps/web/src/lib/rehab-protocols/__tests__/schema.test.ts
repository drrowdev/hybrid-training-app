/**
 * The library is writable directly through PostgREST under RLS, so this schema
 * is the first line of defence rather than the only one — migration 0134 adds
 * matching CHECK constraints. These bounds are deliberately identical to the
 * wizard's `rehabItemSchema`: a protocol authored in Settings must satisfy
 * exactly what the wizard used to enforce, or it could not be deployed.
 */
import { describe, it, expect } from "vitest";
import { parseRehabProtocolInput } from "../schema";

const movementA = "11111111-1111-1111-1111-111111111111";
const movementB = "22222222-2222-2222-2222-222222222222";

const item = (over: Record<string, unknown> = {}) => ({
  movementId: movementA,
  movementName: "Wrist Curl",
  side: "both",
  sets: 3,
  reps: 15,
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  name: "Golfer's Elbow",
  definition: { items: [item()], links: [], ...(over.definition ?? {}) },
  ...(over.name != null ? { name: over.name } : {}),
});

describe("parseRehabProtocolInput", () => {
  it("accepts a minimal protocol", () => {
    const result = parseRehabProtocolInput(input());
    expect(result.ok).toBe(true);
  });

  it("accepts a hold instead of reps", () => {
    const result = parseRehabProtocolInput(
      input({ definition: { items: [item({ reps: undefined, holdSeconds: 30 })], links: [] } }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a movement with neither reps nor a hold", () => {
    const result = parseRehabProtocolInput(
      input({ definition: { items: [item({ reps: undefined })], links: [] } }),
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/reps or a hold time/i);
  });

  it("rejects an empty protocol", () => {
    expect(parseRehabProtocolInput(input({ definition: { items: [], links: [] } })).ok).toBe(
      false,
    );
  });

  it("rejects more than 20 movements", () => {
    const items = Array.from({ length: 21 }, () => item());
    expect(parseRehabProtocolInput(input({ definition: { items, links: [] } })).ok).toBe(
      false,
    );
  });

  it("rejects a blank name", () => {
    expect(parseRehabProtocolInput(input({ name: "   " })).ok).toBe(false);
  });

  it("rejects unknown fields rather than silently dropping them", () => {
    const result = parseRehabProtocolInput(
      input({ definition: { items: [item({ tempo: "3010" })], links: [] } }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a superset naming a movement the protocol doesn't contain", () => {
    // The deploy path already refuses an orphaned rehab link. Moving authoring
    // into Settings must not let one through to fail later at deploy time.
    const result = parseRehabProtocolInput(
      input({
        definition: {
          items: [item(), item({ movementId: movementB, movementName: "Reverse Curl" })],
          links: [
            {
              id: "station-a",
              name: "Station A",
              members: [movementA, "33333333-3333-3333-3333-333333333333"],
            },
          ],
        },
      }),
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/isn't in this protocol/i);
  });

  it("accepts a superset over movements the protocol does contain", () => {
    const result = parseRehabProtocolInput(
      input({
        definition: {
          items: [item(), item({ movementId: movementB, movementName: "Reverse Curl" })],
          links: [{ id: "station-a", name: "Station A", members: [movementA, movementB] }],
        },
      }),
    );
    expect(result.ok).toBe(true);
  });
});
