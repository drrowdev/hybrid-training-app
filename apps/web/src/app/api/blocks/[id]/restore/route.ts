/**
 * Restore a soft-deleted training block.
 *
 * POST /api/blocks/[id]/restore — symmetric to the session restore
 * route. Called from the Undo banner and the Trash page.
 */
import { NextResponse } from "next/server";
import { restoreBlock } from "@/lib/planner/actions";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const result = await restoreBlock(id);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
