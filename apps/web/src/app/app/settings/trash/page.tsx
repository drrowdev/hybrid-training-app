/**
 * /app/settings/trash — list and recover soft-deleted blocks + sessions.
 *
 * The only page in the app that selects rows with `deleted_at IS NOT
 * NULL`. Two sections (blocks, sessions). Each row has a Recover
 * button and a Permanently delete button — the latter opens a
 * type-to-confirm modal (TrashItemRow). Per AGENTS.md DC-K4: hard
 * deletion is the last resort and gated behind explicit user input.
 *
 * The 30-day cleanup cron (apps/web/src/app/api/cron/trash-cleanup)
 * hard-deletes rows where `deleted_at < NOW() - INTERVAL '30 days'`.
 * The page surfaces that policy in the info card at the top so users
 * understand the soft-delete is not forever.
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getTrashedItems } from "@/lib/planner/queries";
import { TrashItemRow } from "@/components/trash/TrashItemRow";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function TrashPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { blocks, sessions } = await getTrashedItems();
  const totalCount = blocks.length + sessions.length;

  return (
    <main
      data-testid="trash-page"
      style={{ display: "grid", gap: 20, maxWidth: 720 }}
    >
      <PageHeader
        back={{ href: "/app/settings/account", label: "Account & data" }}
        title={
          <>
            Trash
            <span style={{ fontSize: 14, color: "var(--cp-text-muted)", fontWeight: 400, marginLeft: 8 }}>
              ({totalCount})
            </span>
          </>
        }
      />

      <section
        role="note"
        style={{
          padding: "12px 14px",
          background: "var(--cp-surface-soft, rgba(0,0,0,0.03))",
          borderRadius: 8,
          fontSize: 13,
          color: "var(--cp-text-muted, #666)",
        }}
      >
        Items in trash are automatically permanently deleted after 30 days.
        Recover an item to put it back where it was.
      </section>

      <section style={{ display: "grid", gap: 8 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>
          Deleted programs{" "}
          <span style={{ fontSize: 13, color: "var(--cp-text-muted)", fontWeight: 400 }}>
            ({blocks.length})
          </span>
        </h2>
        {blocks.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
            No deleted programs.
          </p>
        ) : (
          <ul
            data-testid="trash-blocks-list"
            style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}
          >
            {blocks.map((b) => (
              <TrashItemRow
                key={b.id}
                kind="block"
                id={b.id}
                title={b.archetypeName}
                subtitle={`Started ${b.startedOn}`}
                confirmToken={b.archetypeName}
                deletedAt={b.deletedAt}
              />
            ))}
          </ul>
        )}
      </section>

      <section style={{ display: "grid", gap: 8 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>
          Deleted sessions{" "}
          <span style={{ fontSize: 13, color: "var(--cp-text-muted)", fontWeight: 400 }}>
            ({sessions.length})
          </span>
        </h2>
        {sessions.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
            No deleted sessions.
          </p>
        ) : (
          <ul
            data-testid="trash-sessions-list"
            style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}
          >
            {sessions.map((s) => (
              <TrashItemRow
                key={s.id}
                kind="session"
                id={s.id}
                title={s.title ?? "Untitled session"}
                subtitle={`Performed ${s.performedOn}`}
                confirmToken={s.performedOn}
                deletedAt={s.deletedAt}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
