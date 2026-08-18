"use client";

/**
 * Gallery chrome for the profile-layout mockups: variant switcher,
 * page header matching the real settings sub-page, and the handful of
 * responsive rules the variants need (media queries can't be expressed
 * in the inline styles the rest of the app uses).
 */

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { VARIANTS } from "./variants";

const ORDER = ["a", "b", "c", "d"] as const;

export function Gallery({ variant }: { variant: string }) {
  const key = ORDER.includes(variant as (typeof ORDER)[number]) ? variant : "a";
  const active = VARIANTS[key];

  return (
    <div className="pl-shell">
      <nav className="pl-switcher" aria-label="Layout variant">
        {ORDER.map((k) => {
          const sel = k === key;
          return (
            <Link
              key={k}
              href={`/dev/profile-layouts?variant=${k}`}
              aria-current={sel ? "page" : undefined}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: sel ? 650 : 500,
                whiteSpace: "nowrap",
                border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
                background: sel ? "var(--cp-accent)" : "var(--cp-surface)",
                color: sel ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
              }}
            >
              {VARIANTS[k].title}
            </Link>
          );
        })}
      </nav>

      <p className="pl-blurb">{active.blurb}</p>

      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Training profile"
        subtitle="The defaults the app uses when it builds a new block."
      />

      {active.render()}

      <style jsx global>{`
        .pl-shell {
          max-width: 1120px;
          margin: 0 auto;
          padding: 28px 28px 96px;
        }
        .pl-switcher {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .pl-blurb {
          margin: 0 0 28px;
          font-size: 12.5px;
          line-height: 1.6;
          color: var(--cp-text-muted);
          max-width: 720px;
          border-left: 2px solid var(--cp-border-strong);
          padding-left: 12px;
        }
        .pl-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          align-items: start;
        }
        .pl-col {
          display: grid;
          gap: 14px;
          align-content: start;
          min-width: 0;
        }
        .pl-grid-4 {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .pl-split {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          align-items: start;
        }
        .pl-cols {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 44px;
          align-items: start;
        }
        .pl-row {
          display: grid;
          grid-template-columns: minmax(160px, auto) minmax(0, 1fr);
          gap: 20px;
          align-items: center;
        }
        @media (max-width: 900px) {
          .pl-shell {
            padding: 20px 16px 96px;
          }
          .pl-grid-2,
          .pl-split,
          .pl-cols {
            grid-template-columns: minmax(0, 1fr);
          }
          .pl-cols {
            gap: 26px;
          }
          .pl-grid-4 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .pl-row {
            grid-template-columns: minmax(0, 1fr);
            gap: 10px;
          }
          .pl-row > div:last-child {
            justify-content: flex-start;
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
}
