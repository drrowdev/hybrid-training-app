/**
 * Shared row shape for the /app/settings/events page. Server-rendered, then
 * handed to client components that render the timeline and the
 * expandable list. Keeping the shape narrow (only what the UI shows)
 * keeps the prop graph easy to reason about.
 */
import type { EventPerformance, EventPriority } from "@/lib/events/schema";

export type EventRowView = {
  id: string;
  name: string;
  eventDate: string;
  priority: EventPriority;
  modality: string | null;
  notes: string | null;
  targetPerformance: EventPerformance | null;
  result: EventPerformance | null;
  completed: boolean;
};
