import { notFound } from "next/navigation";
import { TodayPreview } from "./preview";

export const dynamic = "force-dynamic";

export default async function TodayPreviewPage({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <TodayPreview month={(await searchParams).view === "month"} />;
}
