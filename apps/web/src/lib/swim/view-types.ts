export type SwimWorkoutView = {
  id: string;
  revision: number;
  sessionId: string | null;
  status: "scheduled" | "started" | "completed" | "skipped";
  planStatus: "active" | "paused" | "finished" | "archived";
  date: string;
  title: string;
  course: string;
  total: string;
  provisional: boolean;
  budgetMinutes: number;
  calibrationLabel?: string;
  stroke: string;
  strokes: string[];
  equipment: string[];
  pool: { numerator: number; denominator: number; unit: "m" | "yd" };
  steps: { id: string; section: string; title: string; detail: string; rest: string; effort: string; pace?: string }[];
  result: null | {
    lengths: number; timeMs: number; rpe?: number; notes?: string; reason?: string; splits?: string; stroke: string;
    equipment?: string[]; course?: string; strokes?: string[];
  };

  deleted: boolean;
  sourceGone?: boolean;
  notes?: string;
};

export type SwimHubView = {
    id: string; revision: number; status: SwimWorkoutView["planStatus"]; goal: string;
    course: string; dates: string; today: string;
    assessment?: { label: string; pace: string };
    workouts: { id: string; date: string; title: string; total: string; status: string; week: number; provisional: boolean }[];
    proposals: {
      id: string; kind: "week" | "benchmark"; status: string; title: string;
      detail: string; changes: { title: string; before: string; after: string }[];
      mainRepeats?: number;
      excludedCount?: number;
      warning?: string;
    }[];
    analytics: {
      weeks: { week: string; course: string; planned: string; actual: string; frequency: number; adherence: string }[];
      bests: { label: string; time: string; date: string }[];
      benchmarks: { label: string; pace: string; date: string }[];
    };
  };

export type SwimResumePreview = {
    planId: string; revision: number; startDate: string;
    dates: { id: string; revision: number; date: string }[];
  };
