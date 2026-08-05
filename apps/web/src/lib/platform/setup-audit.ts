export function programSetupAuditInput(args: {
  values: Record<string, unknown>;
  weekdays: number[];
  startedOn: string;
  startWeekIndex?: number;
}) {
  return {
    values: args.values,
    weekdays: args.weekdays,
    startedOn: args.startedOn,
    ...(args.startWeekIndex != null && args.startWeekIndex > 0
      ? { startWeekIndex: args.startWeekIndex }
      : {}),
  };
}
