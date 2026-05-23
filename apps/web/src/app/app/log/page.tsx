import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import { todayYmd } from "@/lib/dates";

// /app/log routes to the currently-open session if any, otherwise to /app/sessions/new.
// This keeps the Log tab as a single zero-friction entry point.
export default async function LogTabEntry() {
  const supabase = await createClient();
  const tz = await getUserTimezone();
  const todayIso = todayYmd(tz);
  const { data: open } = await supabase
    .from("sessions")
    .select("id")
    .is("completed_at", null)
    .is("deleted_at", null)
    .gte("performed_at", `${todayIso}T00:00:00`)
    .order("performed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open?.id) redirect(`/app/sessions/${open.id}`);
  redirect("/app/sessions/new");
}
