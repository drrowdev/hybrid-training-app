import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/planner/queries";
import {
  getRegionFreshnessDetail,
  getBucketPressure,
  getCeilingExplain,
  getRecentOverrides,
} from "@/lib/stats/engine";
import { RecoveryView } from "@/components/stats/RecoveryView";

export const dynamic = "force-dynamic";

export default async function EnginePage() {
  const supabase = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles")
    .select("timezone, time_format, date_format").eq("id", user.id).maybeSingle();
  const tz = profile?.timezone ?? (await getUserTimezone(user.id));
  const [regions, buckets, ceiling, overrides] = await Promise.all([
    getRegionFreshnessDetail(supabase, user.id, tz),
    getBucketPressure(supabase, user.id, tz),
    getCeilingExplain(supabase, user.id),
    getRecentOverrides(supabase, user.id, 10),
  ]);

  return <RecoveryView regions={regions} buckets={buckets} ceiling={ceiling}
    overrides={overrides.events} formatProfile={profile} />;
}
