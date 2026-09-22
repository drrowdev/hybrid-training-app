export interface TrainingCommitment {
  id: string;
  source: "primary" | "swim" | "session";
  programId: string | null;
  date: string;
  title: string;
  state: "scheduled" | "started" | "completed" | "rest" | "paused";
}

export function trainingScheduleAdvice(
  commitments: readonly TrainingCommitment[],
  proposedDates: readonly string[],
  exclude?: { source: TrainingCommitment["source"]; programId: string },
) {
  const dates = new Set(proposedDates);
  const relevant = commitments.filter((entry) => dates.has(entry.date) &&
    !(exclude && entry.source === exclude.source && entry.programId === exclude.programId));
  return {
    overlaps: relevant.filter((entry) => entry.state !== "rest" && entry.state !== "paused"),
    plannedRest: relevant.filter((entry) => entry.state === "rest"),
    paused: relevant.filter((entry) => entry.state === "paused"),
  };
}

export function commitmentWeekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}
