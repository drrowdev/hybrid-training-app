import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { isAdminEmail } from "@/lib/admin/access";
import { loadBlockReviewData } from "@/lib/admin/block-review-loader";
import { buildBlockReviewMarkdown } from "@/lib/admin/block-review-export";
import { AdminPlanReviewClient } from "@/components/admin/AdminPlanReviewClient";

export const dynamic = "force-dynamic";

/**
 * Admin-only plan-review export. Gathers the admin's active (or a
 * specified) generated block plus their full context into a markdown
 * document for objective external review. Gated by the ADMIN_EMAILS
 * allowlist — non-admins are redirected to /app and the route is inert
 * when the env var is unset.
 */
export default async function AdminPlanReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ blockId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/app");

  const { blockId } = await searchParams;
  const data = await loadBlockReviewData(supabase, user.id, blockId);

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 900, margin: "0 auto", padding: "8px 0" }}>
      <PageHeader back={{ href: "/app", label: "Today" }} title="Plan review export" />

      <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 14, lineHeight: 1.55 }}>
        Admin-only. Exports a self-contained markdown document for the{" "}
        {blockId ? "specified" : "active"} block — full athlete context, the
        archetype&rsquo;s intended design, and the complete week-by-week
        prescription — with a review rubric on top, ready to paste into a
        deep-research AI tool for an objective quality review.
      </p>

      {data ? (
        <AdminPlanReviewClient
          markdown={buildBlockReviewMarkdown(data)}
          filename={`plan-review-${data.block.archetypeId}-${data.generatedAt.slice(0, 10)}.md`}
        />
      ) : (
        <div
          data-testid="admin-review-empty"
          style={{
            fontSize: 14,
            color: "var(--cp-text-muted)",
            padding: 16,
            borderRadius: 12,
            background: "var(--cp-surface)",
            border: "1px solid var(--cp-border)",
          }}
        >
          No block found. Generate a block first, or pass <code>?blockId=…</code>.
        </div>
      )}
    </div>
  );
}
