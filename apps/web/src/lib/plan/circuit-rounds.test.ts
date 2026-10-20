import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { cardioRoundLogMode } from "./circuit-rounds";

const station = (round: number, position: number, kind = "cardio_threshold") => {
  const id = `part-1:${round}:${position}`;
  return {
    kind, movementId: `m${position}`, movementName: `Station ${position}`,
    circuit: { id, name: "Station circuit", position: 0, size: 1, rounds: 1 },
    meta: { authoredPartId: id },
  } as unknown as PrescriptionItem;
};

describe("cardioRoundLogMode", () => {
  const items = [0, 1].flatMap((round) => [station(round, 0), station(round, 1), station(round, 2, "accessory"), station(round, 3)]);

  it("asks for the round time on the last cardio station of each round", () => {
    expect(cardioRoundLogMode(items[3]!, items)).toBe("round");
    expect(cardioRoundLogMode(items[7]!, items)).toBe("round");
  });

  it("makes earlier cardio stations a one-tap done", () => {
    expect(cardioRoundLogMode(items[0]!, items)).toBe("marker");
    expect(cardioRoundLogMode(items[1]!, items)).toBe("marker");
    expect(cardioRoundLogMode(items[4]!, items)).toBe("marker");
  });

  it("logs a lone cardio station, or one outside an expanded round, on its own", () => {
    const lone = [station(0, 0), station(0, 1, "accessory")];
    expect(cardioRoundLogMode(lone[0]!, lone)).toBe("own");
    const plain = { kind: "cardio_z2", movementId: "r", movementName: "Run", meta: { authoredPartId: "part-2" } } as unknown as PrescriptionItem;
    expect(cardioRoundLogMode(plain, [plain])).toBe("own");
  });
});
