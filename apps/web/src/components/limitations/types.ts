/**
 * Types shared between the /app/recovery/injuries page (server
 * component, runs the queries) and its client components (modal,
 * card, history list).
 *
 * The page passes plain serialisable rows down — never the Supabase
 * client itself — so this file has zero runtime dependencies and can
 * be imported from both server and client modules.
 */
import type { MuscleGroup } from "@/lib/muscle/muscle-groups";

export type LimitationRow = {
  id: string;
  kind: string | null;
  severity: "mild" | "moderate" | "severe";
  region: string | null;
  affectedMuscles: MuscleGroup[];
  affectedMovementIds: string[];
  notes: string | null;
  expectedDurationDays: number | null;
  startedAt: string;
  resolvedAt: string | null;
  engineAction: Record<string, unknown>;
};

export type MovementRef = {
  id: string;
  slug: string;
  displayName: string;
};

export type EngineEventRow = {
  id: string;
  occurredAt: string;
  eventType: "skip" | "swap" | "manual_end" | "custom";
  originalMovementSlug: string | null;
  newMovementSlug: string | null;
  reason: string | null;
};
