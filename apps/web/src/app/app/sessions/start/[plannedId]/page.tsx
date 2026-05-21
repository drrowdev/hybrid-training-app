import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { startCheckInSession } from "@/lib/planner/actions";
import { CheckInForm } from "@/components/sessions/CheckInForm";

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ plannedId: string }>;
}) {
  const { plannedId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(plannedId)) redirect("/app");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, title, completed_session_id")
    .eq("id", plannedId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!planned) redirect("/app");
  if (planned.completed_session_id) redirect(`/app/sessions/${planned.completed_session_id}`);

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 640, margin: "0 auto" }}>
      <CheckInForm
        plannedId={planned.id}
        sessionTitle={planned.title}
        startAction={startCheckInSession}
      />
    </div>
  );
}
