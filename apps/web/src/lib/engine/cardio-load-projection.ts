import type { SupabaseClient } from "@supabase/supabase-js";

const BASE_COLUMNS = "session_id, duration_sec, rpe, modality, hr_zones, movement:movements(primary_region, secondary_regions)";

export function cardioLoadQuery(client: SupabaseClient, includeSwimming: boolean) {
  const query = client.from("cardio_logs");
  return includeSwimming
    ? query.select(`${BASE_COLUMNS}, swim_result`)
    : query.select(BASE_COLUMNS);
}
