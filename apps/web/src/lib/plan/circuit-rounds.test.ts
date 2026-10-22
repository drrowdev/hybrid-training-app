import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { cardioRoundLogMode, roundTimeStation } from "./circuit-rounds";

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
  const endsOnStrength = [0, 1].flatMap((round) => [station(round, 0), station(round, 1), station(round, 2, "accessory")]);

  it("asks for the round time on the last station when it is cardio", () => {
    expect(cardioRoundLogMode(items[3]!, items)).toBe("round");
    expect(cardioRoundLogMode(items[7]!, items)).toBe("round");
  });

  it("makes earlier cardio stations a one-tap done", () => {
    expect(cardioRoundLogMode(items[0]!, items)).toBe("marker");
    expect(cardioRoundLogMode(items[1]!, items)).toBe("marker");
    expect(cardioRoundLogMode(items[4]!, items)).toBe("marker");
  });

  it("makes every cardio station a one-tap done when the round ends on strength", () => {
    expect(cardioRoundLogMode(endsOnStrength[0]!, endsOnStrength)).toBe("marker");
    expect(cardioRoundLogMode(endsOnStrength[1]!, endsOnStrength)).toBe("marker");
  });

  it("logs a lone cardio station, or one outside an expanded round, on its own", () => {
    const lone = [station(0, 0)];
    expect(cardioRoundLogMode(lone[0]!, lone)).toBe("own");
    const plain = { kind: "cardio_z2", movementId: "r", movementName: "Run", meta: { authoredPartId: "part-2" } } as unknown as PrescriptionItem;
    expect(cardioRoundLogMode(plain, [plain])).toBe("own");
  });
});

describe("roundTimeStation", () => {
  const entries = [0, 1].flatMap((round) => [station(round, 0), station(round, 1), station(round, 2, "accessory")])
    .map((item, index) => ({ item, index }));

  it("points at the round's last cardio station once its closing strength station is logged", () => {
    expect(roundTimeStation(entries, 2)).toMatchObject({ index: 1, round: 1 });
    expect(roundTimeStation(entries, 5)).toMatchObject({ index: 4, round: 2 });
  });

  it("is null for any other station", () => {
    expect(roundTimeStation(entries, 0)).toBeNull();
    expect(roundTimeStation(entries, 1)).toBeNull();
  });

  it("is null when the round ends on cardio, which asks for the time itself", () => {
    const cardioEnd = [station(0, 0), station(0, 1)].map((item, index) => ({ item, index }));
    expect(roundTimeStation(cardioEnd, 1)).toBeNull();
  });
});
