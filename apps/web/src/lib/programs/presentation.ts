export function formatProgramDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}

export function programWorkoutTitle(title: string, template: boolean): string {
  return template ? title.replace(/\s*·\s*\d+(?:\.\d+)?%\s*$/, "") : title;
}

export function hasTemplateWorkoutTitles(program: { programId: string | null; archetype: string | null }): boolean {
  return program.programId !== "authored" && program.archetype !== "custom";
}
