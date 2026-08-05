export function programSetupAuditInput(args: {
  values: Record<string, unknown>;
  weekdays: number[];
  startedOn: string;
  startWeekIndex?: number;
  customization?: unknown;
}) {
  return {
    values: args.values,
    weekdays: args.weekdays,
    startedOn: args.startedOn,
    ...(args.customization ? { customization: args.customization } : {}),
    ...(args.startWeekIndex != null && args.startWeekIndex > 0
      ? { startWeekIndex: args.startWeekIndex }
      : {}),
  };
}
