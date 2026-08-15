/**
 * Prescription item kind → `set_logs.set_kind`.
 *
 * Many-to-one: `power_potentiation` logs as a `main` set. Shared so the client
 * that submits a set and the server that validates its prescribed snapshot
 * (ADR 0070) agree on slot identity — otherwise the identity guard would reject
 * every potentiation set as a mismatch.
 */
export type LoggedSetKind = "warmup" | "main" | "back_off" | "accessory" | "tendon";

export const SET_KIND_TO_LOG: Record<string, LoggedSetKind> = {
  warmup: "warmup",
  main: "main",
  back_off: "back_off",
  accessory: "accessory",
  tendon: "tendon",
  power_potentiation: "main",
};

export function loggedSetKindForItemKind(kind: string | undefined): LoggedSetKind {
  return (kind && SET_KIND_TO_LOG[kind]) || "main";
}
