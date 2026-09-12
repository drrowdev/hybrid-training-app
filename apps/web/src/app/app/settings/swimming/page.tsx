import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SwimImportConnection } from "@/components/swim/SwimImportConnection";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadSwimImports } from "@/lib/swim/import-storage";

export default async function SwimmingImportSettings() {
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const view = await loadSwimImports(await createClient(), user.id);
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/app/settings", label: "Settings" }} title="Swimming imports" />
      {!view.available
        ? <p>Swimming imports are not available yet.</p>
        : <>
          <SwimImportConnection enabled={view.enabled} connection={view.connections.find((item) => item.revoked_at === null) ?? null} />
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Recent imports</h2>
            {view.imports.length === 0
              ? <p className="text-sm" style={{ color: "var(--cp-text-muted)" }}>No swims imported yet.</p>
              : <ol className="space-y-2">
                {view.imports.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3"
                  style={{ padding: 16, border: "1px solid var(--cp-border)", borderRadius: 10, background: "var(--cp-surface)" }}>
                  <div>
                    <p className="font-semibold">{item.evidence.environment === "pool" ? "Pool swim" : "Open-water swim"}</p>
                    <time className="text-sm" dateTime={item.evidence.date} style={{ color: "var(--cp-text-muted)" }}>{item.evidence.date}</time>
                  </div>
                  <div className="text-right">
                    <p>{new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(item.evidence.distanceMetres)} m</p>
                    {item.revision > 1 && <p className="text-xs" style={{ color: "var(--cp-text-muted)" }}>Revision {item.revision}</p>}
                  </div>
                </li>)}
              </ol>}
          </section>
        </>}
    </div>
  );
}
