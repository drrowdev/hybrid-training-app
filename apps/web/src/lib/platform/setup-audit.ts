export function programSetupAuditInput(args: {
  values: Record<string, unknown>;
  weekdays: number[];
  startedOn: string;
  startWeekIndex?: number;
  customization?: unknown;
  /**
   * User-authored superset links. Persisted as a SIBLING of `customization`,
   * never nested inside it, so `edit-context` can parse each independently — a
   * malformed customization must not take the links down with it, and vice versa.
   */
  sessionLinks?: unknown;
}) {
  return {
    values: args.values,
    weekdays: args.weekdays,
    startedOn: args.startedOn,
    ...(args.customization ? { customization: args.customization } : {}),
    ...(args.sessionLinks ? { sessionLinks: args.sessionLinks } : {}),
    ...(args.startWeekIndex != null && args.startWeekIndex > 0
      ? { startWeekIndex: args.startWeekIndex }
      : {}),
  };
}
