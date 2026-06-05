import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { formatHitValue, getRecentPrs } from "@/lib/stats/pr-queries";
import { PR_KIND_LABEL } from "@/lib/engine/pr";
import { formatDate } from "@/lib/format/datetime";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AllPrsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const [{ data: profile }, prs] = await Promise.all([
    supabase
      .from("profiles")
      .select("timezone, time_format, date_format")
      .eq("id", user.id)
      .maybeSingle(),
    getRecentPrs(supabase, user.id, 60),
  ]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <PageHeader
        back={{ href: "/app/stats", label: "Stats" }}
        title="All PRs"
        subtitle="Every personal record we've caught, newest first. Weight PRs, reps-at-weight PRs, and estimated-1RM PRs are tracked separately — a session can fire more than one."
      />

      {prs.length === 0 ? (
        <section className="cp-card" style={{ padding: 20 }}>
          <p style={{ margin: 0, color: "var(--cp-text-muted)", fontSize: 14 }}>
            No PRs logged yet. Start lifting; we&apos;ll catch them.
          </p>
        </section>
      ) : (
        <section className="cp-card" style={{ padding: 20 }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {prs.map((p, i) => (
              <li
                key={`${p.sessionId}:${p.movementId}:${p.hit.kind}`}
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--cp-border)",
                  padding: "12px 0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 10,
                  fontSize: 13,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span aria-hidden="true">🏆</span>
                    <Link
                      href={p.movementSlug ? `/app/stats/movements/${p.movementSlug}` : `/app/sessions/${p.sessionId}`}
                      style={{ fontWeight: 500, color: "var(--cp-text)", textDecoration: "none" }}
                    >
                      {p.movementDisplayName}
                    </Link>
                    <span className="cp-pill" style={{ fontSize: 10 }}>{PR_KIND_LABEL[p.hit.kind]}</span>
                  </div>
                  {p.hit.previousBest != null && (
                    <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 4 }}>
                      previous best{" "}
                      <span className="mono">
                        {formatHitValue({ ...p.hit, value: p.hit.previousBest }, p.hit.kind)}
                      </span>
                      {p.hit.daysSincePrevious != null && (
                        <span style={{ marginLeft: 6 }}>· {p.hit.daysSincePrevious} days earlier</span>
                      )}
                    </div>
                  )}
                </div>
                <span className="mono" style={{ fontWeight: 600, color: "var(--cp-accent)", flexShrink: 0 }}>
                  {formatHitValue(p.hit, p.hit.kind)}
                </span>
                <span style={{ fontSize: 11, color: "var(--cp-text-muted)", flexShrink: 0, minWidth: 80, textAlign: "right" }}>
                  <Link href={`/app/sessions/${p.sessionId}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {formatDate(p.sessionPerformedAt, profile)}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
