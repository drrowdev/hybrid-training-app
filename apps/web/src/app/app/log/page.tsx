import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// /app/log routes to the currently-open session if any, otherwise to /app/sessions/new.
// This keeps the Log tab as a single zero-friction entry point.
export default async function LogTabEntry() {
  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: open } = await supabase
    .from("sessions")
    .select("id")
    .is("completed_at", null)
    .gte("performed_at", `${todayIso}T00:00:00`)
    .order("performed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open?.id) redirect(`/app/sessions/${open.id}`);
  redirect("/app/sessions/new");
}
