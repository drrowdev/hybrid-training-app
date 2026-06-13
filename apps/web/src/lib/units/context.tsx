"use client";

import { createContext, useContext } from "react";
import type { WeightUnit } from "@/lib/stats/units";

/**
 * Weight-unit context for the session-logging subtree.
 *
 * The session page reads `profiles.units` once and wraps the logger in
 * `<UnitsProvider>`; leaf components (set logger, plate view, recap rows) read
 * the unit via `useUnits()` instead of threading a prop through every hop.
 *
 * Defaults to "metric" so components rendered OUTSIDE a provider (e.g. isolated
 * unit tests) keep their kg behaviour unchanged.
 */
const UnitsContext = createContext<WeightUnit>("metric");

export function UnitsProvider({
  units,
  children,
}: {
  units: WeightUnit;
  children: React.ReactNode;
}) {
  return <UnitsContext.Provider value={units}>{children}</UnitsContext.Provider>;
}

export function useUnits(): WeightUnit {
  return useContext(UnitsContext);
}
