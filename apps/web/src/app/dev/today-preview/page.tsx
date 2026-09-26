import { notFound } from "next/navigation";
import { TodayPreview } from "./preview";
import { WorkoutHistoryPreview } from "./workout-history-preview";

export const dynamic = "force-dynamic";

export default async function TodayPreviewPage({ searchParams }: {
  searchParams: Promise<{ view?: string; history?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  if (params.history) return <WorkoutHistoryPreview before={params.history === "before"} />;
  return <TodayPreview month={params.view === "month"} />;
}
