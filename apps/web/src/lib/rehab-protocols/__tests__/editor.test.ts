import { describe, expect, it } from "vitest";
import { formatRehabReps } from "@hta/domain";
import { parseRehabProtocolDraft } from "../editor";

const movement = {
  movementId: "11111111-1111-4111-8111-111111111111",
  movementName: "Copenhagen Plank",
  sets: 3,
  side: "both" as const,
};

function draft(reps = "8-10") {
  return {
    name: "  Adductor rehab  ",
    items: [
      { ...movement, reps: "", holdSeconds: 20, instructions: "Isometric" },
      { ...movement, reps, instructions: "Dynamic" },
    ],
    links: [],
  };
}

describe("rehab protocol draft", () => {
  it("saves the screenshot's hold-only and rep-range rows without changing either", () => {
    const original = draft();
    const parsed = parseRehabProtocolDraft(original);
    expect(parsed).toEqual({
      ok: true,
      value: {
        name: "Adductor rehab",
        definition: {
          items: [
            { ...movement, holdSeconds: 20, instructions: "Isometric" },
            { ...movement, reps: 8, repRange: { min: 8, max: 10 }, instructions: "Dynamic" },
          ],
          links: [],
        },
      },
    });
    expect(original).toEqual(draft());
  });

  it.each(["8-", "10-8", "8.5", "501", "many"])(
    "identifies the row containing invalid reps %j and preserves the typed value",
    (reps) => {
      const original = draft(reps);
      const result = parseRehabProtocolDraft(original);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(movement.movementName);
        expect(result.error).toMatch(/movement 2/i);
      }
      expect(original.items[1]!.reps).toBe(reps);
    },
  );

  it("identifies the row with neither reps nor hold time", () => {
    const result = parseRehabProtocolDraft(draft(""));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/movement 2/i);
      expect(result.error).toMatch(/reps or a hold time/i);
    }
  });

  it("round-trips saved ranges back into an editable draft", () => {
    const saved = parseRehabProtocolDraft(draft());
    if (!saved.ok) throw new Error(saved.error);
    const reopened = {
      name: saved.value.name,
      items: saved.value.definition.items.map(({ reps, repRange, ...item }) => ({
        ...item,
        reps: formatRehabReps({ reps, repRange }),
      })),
      links: saved.value.definition.links,
    };
    expect(reopened.items[1]!.reps).toBe("8-10");
    expect(parseRehabProtocolDraft(reopened)).toEqual(saved);
  });

  it("saves a single rep count without adding a range", () => {
    const result = parseRehabProtocolDraft(draft("10"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.definition.items[1]!.reps).toBe(10);
      expect(result.value.definition.items[1]!.repRange).toBeUndefined();
    }
  });
});
