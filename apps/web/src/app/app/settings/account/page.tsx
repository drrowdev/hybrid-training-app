import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { deleteAccount } from "@/lib/auth/delete-account";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Trash count = soft-deleted blocks + sessions belonging to the
  // current user. Both queries are cheap (partial index in 0026 on
  // `deleted_at IS NOT NULL`).
  const [{ count: trashedBlockCount }, { count: trashedSessionCount }] =
    await Promise.all([
      supabase
        .from("training_blocks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .not("deleted_at", "is", null),
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .not("deleted_at", "is", null),
    ]);
  const trashCount = (trashedBlockCount ?? 0) + (trashedSessionCount ?? 0);

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Account & data"
        subtitle="Trash, exports, and account deletion."
      />
      <p className="text-xs text-foreground/50 font-mono">{user.email}</p>

      <div className="space-y-6">
        {/* Trash */}
        <div className="space-y-2">
          <p className="text-xs text-foreground/60">
            Recover or permanently remove soft-deleted programs and sessions.
          </p>
          <Link
            href="/app/settings/trash"
            data-testid="settings-trash-link"
            className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
          >
            <span className="text-sm">Trash</span>
            <span className="text-xs text-foreground/60">
              {trashCount} item{trashCount === 1 ? "" : "s"} →
            </span>
          </Link>
        </div>

        {/* Export */}
        <div className="space-y-2">
          <p className="text-xs text-foreground/60">
            Download everything we hold on you (GDPR Articles 15 + 20).
          </p>
          <a
            href="/api/me/export"
            download
            className="inline-block rounded-md border border-foreground/20 px-3 py-1.5 text-sm hover:bg-foreground/5"
          >
            Export my data (JSON)
          </a>
        </div>

        {/* Danger zone */}
        <div
          className="space-y-3 mt-2 pt-4 border-t border-red-600/30 rounded-lg border border-red-600/20 bg-red-50/40 dark:bg-red-950/20 p-4"
          data-testid="settings-danger-zone"
        >
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
            Danger zone
          </h2>
          <form action={deleteAccount}>
            <button
              type="submit"
              className="rounded-md border border-red-600/40 text-red-700 dark:text-red-400 px-3 py-1.5 text-sm hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              Delete account (GDPR Art. 17)
            </button>
            <p className="text-xs text-foreground/50 mt-2">
              Hard-deletes your auth record and cascades to all sessions,
              sets, cardio entries, limitations, and bodyweight history.
              Irreversible.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
