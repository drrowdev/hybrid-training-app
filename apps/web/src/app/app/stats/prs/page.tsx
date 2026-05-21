import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatHitValue, getRecentPrs } from "@/lib/stats/pr-queries";
import { PR_KIND_LABEL } from "@/lib/engine/pr";

export default async function AllPrsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const prs = await getRecentPrs(supabase, user.id, 60);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <Link href="/app/stats" style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}>
          ← stats
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>All PRs</h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Every personal record we&apos;ve caught, newest first. Weight PRs, reps-at-weight PRs,
          and estimated-1RM PRs are tracked separately — a session can fire more than one.
        </p>
      </header>

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
                    {new Date(p.sessionPerformedAt).toLocaleDateString()}
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
