/**
 * /plan/new client switch — toggles between the "Run it again" list and the
 * BlockWizard. Lives outside the server page so the wizard's reducer state
 * survives the back-and-forth, and so the server page stays a thin shell.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  BlockWizard,
  type TmReadinessByArchetype,
  type WizardSubmit,
} from "./BlockWizard";

export type RecentBlockCard = {
  id: string;
  archetype: string;
  archetypeName: string;
  startedOn: string;
  daysPerWeek: number | null;
  status: "active" | "completed" | "archived";
  dayIndexOverrides: { days: number[]; twoADay: boolean } | null;
};

export type CreateBlockResult = { ok: true } | { ok: false; error: string };

const ARCHETYPE_NAMES: Record<string, string> = {
  strength_anchor: "Strength Focus",
  endurance_anchor: "Endurance Focus",
  hypertrophy_anchor: "Hypertrophy Focus",
  concurrent_hybrid: "Hybrid Focus",
  rebuild: "Rebuild",
  maintenance: "Maintenance",
  custom: "Custom block",
};

export function PlanNewSwitch({
  recentBlocks,
  tmReadinessByArchetype,
  allowsTwoADays,
  todayYmd,
  action,
}: {
  recentBlocks: RecentBlockCard[];
  tmReadinessByArchetype: TmReadinessByArchetype;
  allowsTwoADays: boolean;
  todayYmd: string;
  action: (fd: FormData) => Promise<CreateBlockResult>;
}): React.ReactElement {
  const [mode, setMode] = useState<"home" | "wizard">("home");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const completeFromWizard = async (submit: WizardSubmit): Promise<CreateBlockResult> => {
    const fd = new FormData();
    fd.set("archetype", submit.archetypeId);
    fd.set("startedOn", todayYmd);
    fd.set("daysPerWeek", String(submit.daysPerWeek));
    fd.set("dayIndexOverrides", JSON.stringify(submit.dayIndexOverrides));
    const result = await action(fd);
    if (result.ok) {
      router.push("/app/plan");
      router.refresh();
    }
    return result;
  };

  const runItAgain = (block: RecentBlockCard): void => {
    setError(null);
    const fd = new FormData();
    fd.set("archetype", block.archetype);
    fd.set("startedOn", todayYmd);
    fd.set("daysPerWeek", String(block.daysPerWeek ?? 4));
    if (block.dayIndexOverrides) {
      fd.set("dayIndexOverrides", JSON.stringify(block.dayIndexOverrides));
    }
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/app/plan");
      router.refresh();
    });
  };

  if (mode === "wizard") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <button
          type="button"
          onClick={() => setMode("home")}
          style={{
            justifySelf: "start",
            background: "transparent",
            border: "none",
            color: "var(--cp-text-muted)",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ← back to recent blocks
        </button>
        <BlockWizard
          onComplete={completeFromWizard}
          tmReadinessByArchetype={tmReadinessByArchetype}
          allowsTwoADays={allowsTwoADays}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {recentBlocks.length > 0 && (
        <section>
          <h2 style={{ fontSize: 16, margin: "0 0 4px", fontWeight: 600 }}>Run it again</h2>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--cp-text-muted)" }}>
            Re-launch the same shape as one of your recent blocks — same days, same focus.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {recentBlocks.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => runItAgain(b)}
                disabled={pending}
                style={recentCardStyle(pending)}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {b.archetypeName}{" "}
                    <span style={{ fontSize: 11, color: "var(--cp-text-muted)", fontWeight: 500 }}>
                      · {b.daysPerWeek ?? "?"} d/wk · started {b.startedOn}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                    {b.status === "active"
                      ? "Active — clone restarts the block today"
                      : b.status === "completed"
                        ? "Completed"
                        : "Archived"}
                  </div>
                </div>
                <span style={{ fontSize: 18, color: "var(--cp-text-muted)" }}>↻</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div style={errorBoxStyle}>{error}</div>
      )}

      <section style={{ display: "grid", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode("wizard");
          }}
          style={primaryCtaStyle}
        >
          Build a new block →
        </button>
        <Link
          href="/app/plan/new/custom"
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            textDecoration: "none",
            justifySelf: "start",
            paddingLeft: 4,
          }}
        >
          More options · build a custom block →
        </Link>
      </section>
    </div>
  );
}

function recentCardStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    background: "var(--cp-surface)",
    border: "1px solid var(--cp-border)",
    borderRadius: 12,
    padding: "14px 18px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    color: "var(--cp-text)",
    textAlign: "left",
    opacity: disabled ? 0.5 : 1,
  };
}

const primaryCtaStyle: React.CSSProperties = {
  background: "var(--cp-accent)",
  color: "var(--cp-accent-fg)",
  border: "1px solid var(--cp-accent)",
  borderRadius: 12,
  padding: "16px 20px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
  justifySelf: "stretch",
};

const errorBoxStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(245, 158, 11, 0.08)",
  border: "1px solid var(--cp-warning, #d97706)",
  color: "var(--cp-text)",
  fontSize: 13,
};

export { ARCHETYPE_NAMES };
