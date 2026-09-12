import { SwimInputError } from "./input-error";

/** Manual pool times retain their original integer millisecond precision. */
export function parseSwimTime(value: string): number {
  const match = /^(\d{1,4}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) throw new SwimInputError("Enter time as minutes:seconds, for example 12:30.");
  const milliseconds = Number(match[1]) * 60_000 + Number(match[2]) * 1000 +
    Number((match[3] ?? "").padEnd(3, "0"));
  if (milliseconds <= 0 || milliseconds > 86_400_000) {
    throw new SwimInputError("Enter a time between 0:00.001 and 1440:00.");
  }
  return milliseconds;
}

export function formatSwimTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor(milliseconds % 60_000 / 1000).toString().padStart(2, "0");
  const fraction = milliseconds % 1000;
  return `${minutes}:${seconds}${fraction ? `.${fraction.toString().padStart(3, "0")}` : ""}`;
}
