export interface TrainingCommitment {
  id: string;
  source: "primary" | "swim" | "session";
  programId: string | null;
  date: string;
  title: string;
  state: "scheduled" | "started" | "completed" | "rest" | "paused";
}

export function isPlannedRest(row: { role?: string | null; prescription?: unknown }): boolean {
  return row.role === "rest" || (
    row.prescription !== null && typeof row.prescription === "object" &&
    "kind" in row.prescription && row.prescription.kind === "rest"
  );
}

export function trainingScheduleAdvice(
  commitments: readonly TrainingCommitment[],
  proposedDates: readonly string[],
  exclude?: { source: TrainingCommitment["source"]; programId: string; retainExistingOverlaps?: boolean },
) {
  const dates = new Set(proposedDates);
  const relevant = commitments.filter((entry) => dates.has(entry.date) &&
    !(exclude && entry.source === exclude.source && entry.programId === exclude.programId));
  const existingDates = new Set(exclude?.retainExistingOverlaps ? commitments.filter((entry) =>
    entry.source === exclude.source && entry.programId === exclude.programId &&
    entry.state !== "rest" && entry.state !== "paused").map((entry) => entry.date) : []);
  return {
    overlaps: relevant.filter((entry) => entry.state !== "rest" && entry.state !== "paused" && !existingDates.has(entry.date)),
    plannedRest: relevant.filter((entry) => entry.state === "rest"),
    paused: relevant.filter((entry) => entry.state === "paused"),
  };
}

export function commitmentWeekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function nextProgramCommitment(
  commitments: readonly TrainingCommitment[], programId: string, today: string, source: "primary" | "swim" = "primary",
): TrainingCommitment | undefined {
  return commitments.filter((entry) => entry.source === source && entry.programId === programId && entry.date >= today && entry.state === "scheduled")
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))[0];
}
