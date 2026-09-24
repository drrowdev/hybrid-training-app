import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SwimImportConnection } from "@/components/swim/SwimImportConnection";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadSwimImports } from "@/lib/swim/import-storage";
import { swimImportMatchingAvailable } from "@/lib/swim/import-matching";
import { formatImportedSwimDistance } from "@/lib/swim/import-presentation";

export default async function SwimmingImportSettings({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const pageValue = (await searchParams).page ?? "1";
  if (!/^[1-9]\d{0,5}$/.test(pageValue)) notFound();
  const page = Number(pageValue);
  const client = await createClient();
  const [view, matching] = await Promise.all([
    loadSwimImports(client, user.id, (page - 1) * 50),
    swimImportMatchingAvailable(client),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/app/settings", label: "Settings" }} title="Swimming imports" />
      {!view.available
        ? <p>Swimming imports aren&apos;t available right now.</p>
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
                    <p>{formatImportedSwimDistance(item.evidence.distanceMetres)}</p>
                    {item.revision > 1 && <p className="text-xs" style={{ color: "var(--cp-text-muted)" }}>Updated recording</p>}
                    {matching && <Link href={`/app/swim/recordings/${item.id}`}>View recording</Link>}
                  </div>
                </li>)}
              </ol>}
            {(page > 1 || view.imports.length === 50) && <nav aria-label="Imports pages" className="flex flex-wrap gap-4">
              {page > 1 && <Link href={`/app/settings/swimming?page=${page - 1}`}>Newer imports</Link>}
              {view.imports.length === 50 && <Link href={`/app/settings/swimming?page=${page + 1}`}>Older imports</Link>}
            </nav>}
          </section>
        </>}
    </div>
  );
}
