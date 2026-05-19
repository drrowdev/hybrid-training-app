import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Liveness + DB connectivity check. No auth required.
 */
export async function GET() {
  const t0 = Date.now();
  try {
    const supabase = await createClient();
    const { error, count } = await supabase
      .from("movements")
      .select("id", { count: "exact", head: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - t0,
      movementsCount: count ?? 0,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown" },
      { status: 503 },
    );
  }
}
