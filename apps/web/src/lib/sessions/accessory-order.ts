/**
 * Smart accessory ordering (render-side).
 *
 * The engine picks accessories in PRIORITY order (durability floor → functional
 * → power → aesthetic → focus), which reads as a "random" sequence to follow at
 * the rack: you bounce between the barbell, a machine, dumbbells, a band, etc.
 * This reorders the accessory CARDS so same-"station" movements sit together —
 * you set up once and do them back-to-back (and antagonist superset pairs, which
 * usually share equipment, naturally land adjacent). The stored prescription and
 * its item indices are untouched (set logging matches by index), so this is a
 * pure presentational permutation.
 */

export type AccessoryMeta = { equipment: string | null; region: string | null };

/**
 * Equipment "stations", ordered so a lifter flows from loaded barbell work
 * through free weights and cables to machines, ending with minimal-kit
 * (band / bodyweight) movements that can be done anywhere. Lower rank = earlier.
 */
const STATION_ORDER: ReadonlyArray<{ rank: number; test: (eq: string) => boolean }> = [
  { rank: 0, test: (eq) => eq.includes("barbell") || eq === "bar" || eq.includes("bar-") || eq.includes("trap") },
  { rank: 1, test: (eq) => eq.includes("dumbbell") || eq.includes("db") || eq.includes("kettlebell") || eq.includes("kb") },
  { rank: 2, test: (eq) => eq.includes("cable") },
  { rank: 3, test: (eq) => eq.includes("machine") || eq.includes("smith") || eq.includes("leg-press") || eq.includes("pec") || eq.includes("pulldown") },
  { rank: 4, test: (eq) => eq.includes("plate") || eq.includes("gripper") },
  { rank: 5, test: (eq) => eq.includes("band") },
  { rank: 6, test: (eq) => eq.includes("bodyweight") || eq.includes("rings") || eq === "floor" || eq === "mat" || eq === "wall" || eq === "bench" },
];

const UNKNOWN_STATION_RANK = 4; // mid-pack, so unknown-equipment items don't all clump at an extreme

export function stationRank(equipment: string | null | undefined): number {
  const eq = (equipment ?? "").toLowerCase().trim();
  if (eq === "") return UNKNOWN_STATION_RANK;
  for (const s of STATION_ORDER) if (s.test(eq)) return s.rank;
  return UNKNOWN_STATION_RANK;
}

/**
 * Stable smart order for a list of accessory items identified by movementId.
 * Returns the input indices permuted so items cluster by equipment station,
 * then region, preserving the engine's original relative order within a cluster
 * (so priority/variety choices still show through). `metaById` missing an entry
 * falls back to the unknown-station rank + the item's original position.
 */
export function smartAccessoryOrder<T>(
  items: ReadonlyArray<T>,
  movementIdOf: (item: T) => string,
  metaById: Readonly<Record<string, AccessoryMeta>>,
): T[] {
  return items
    .map((item, index) => {
      const meta = metaById[movementIdOf(item)];
      return {
        item,
        index,
        station: stationRank(meta?.equipment),
        region: meta?.region ?? "",
      };
    })
    .sort((a, b) => {
      if (a.station !== b.station) return a.station - b.station;
      if (a.region !== b.region) return a.region.localeCompare(b.region);
      return a.index - b.index; // stable within a cluster
    })
    .map((x) => x.item);
}
