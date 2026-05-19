import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/movements/search?q=squat&limit=15&pattern=press
 * Movement autocomplete for the logging UI.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit") ?? "20")),
  );
  const pattern = url.searchParams.get("pattern");

  let query = supabase
    .from("movements")
    .select(
      "id, slug, display_name, pattern, primary_region, primary_muscles, equipment, is_compound",
    )
    .order("display_name", { ascending: true })
    .limit(limit);

  if (q.length > 0) {
    const safe = q.replace(/[%_]/g, "\\$&");
    query = query.or(
      `display_name.ilike.%${safe}%,slug.ilike.%${safe}%,pattern.ilike.%${safe}%`,
    );
  }
  if (pattern) query = query.eq("pattern", pattern);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ movements: data ?? [] });
}
