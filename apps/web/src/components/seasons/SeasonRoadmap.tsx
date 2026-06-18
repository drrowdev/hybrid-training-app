"use client";

/**
 * Season roadmap (ADR 0051 Phase 0) — the opt-in "Season" tab on /app/plan.
 *
 * Data-only macrocycle sequencing: a named Season is an ordered list of block
 * intentions, each a (program, emphasis) pair plus a one-line "why". This slice
 * is the read + build surface only — no day-by-day materialisation, no balance
 * slider, no event anchor, no auto-suggest engine (all deferred to later
 * phases). Drag-reorder is also out of scope (slice D).
 *
 * Two states:
 *   - empty (no active Season): a friendly create builder.
 *   - populated: a horizontal, overflow-scrolling rail of block cards in
 *     position order, an inline "+ Add block" card, and an "End season" control.
 *
 * All mutations go through the existing RLS-safe server actions; after each one
 * we `router.refresh()` to re-pull the server-rendered Season.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActiveSeason, UpcomingEvent } from "@/lib/seasons/queries";
import {
  createSeason,
  addSeasonBlock,
  removeSeasonBlock,
  updateSeasonBlock,
  reorderSeasonBlocks,
  setSeasonGoal,
  abandonSeason,
} from "@/lib/seasons/actions";
import {
  weeksUntil,
  remainingPlannedWeeks,
  goalRunwayStatus,
} from "@/lib/seasons/goal-math";
import { emphasisToSlot, selectNextBlock } from "@/lib/seasons/select-next-block";
import type { SeasonEmphasis } from "@hta/db";
import styles from "./SeasonRoadmap.module.css";

export type SeasonRoadmapProgram = { id: string; name: string };

export type SeasonRoadmapProps = {
  /** The user's active Season, or null when they haven't built one yet. */
  season: ActiveSeason | null;
  /** Selectable programs a block can reference, in picker order. */
  programs: SeasonRoadmapProgram[];
  /** Valid emphasis tags (the DB enum order). */
  emphasisOptions: readonly string[];
  /** Today (YYYY-MM-DD, user tz) for the goal "N weeks out" back-calc. */
  today: string;
  /** Upcoming A-priority events the user can anchor the Season to. */
  upcomingEvents: UpcomingEvent[];
};

/** Friendly labels for the emphasis enum (hybrid strength↔endurance bias). */
const EMPHASIS_LABEL: Record<string, string> = {
  base: "Base",
  strength_bias: "Strength focus",
  endurance_bias: "Engine focus",
  build: "Build",
  peak: "Peak",
  realize: "Realize",
  recovery: "Recovery",
};

const MAX_SEASON_BLOCKS = 8;

function emphasisLabel(value: string): string {
  return EMPHASIS_LABEL[value] ?? value;
}

/** Advisory maintenance-floor line for a bias block (ADR 0051 Decision 7).
 *  Qualitative for now — the held quality stays at a maintenance floor so it
 *  doesn't detrain. The live interference-scalar check is a later phase. */
function biasFloorNote(emphasis: string): string | null {
  if (emphasis === "strength_bias")
    return "Cardio held at a maintenance floor so your engine doesn’t fade.";
  if (emphasis === "endurance_bias")
    return "Strength held at a maintenance floor so you don’t detrain it.";
  return null;
}

type BlockDraft = {
  programId: string;
  emphasis: string;
  intentNote: string;
};

function newDraft(
  programs: SeasonRoadmapProgram[],
  emphasisOptions: readonly string[],
): BlockDraft {
  return {
    programId: programs[0]?.id ?? "",
    emphasis: emphasisOptions[0] ?? "base",
    intentNote: "",
  };
}

export function SeasonRoadmap({
  season,
  programs,
  emphasisOptions,
  today,
  upcomingEvents,
}: SeasonRoadmapProps) {
  if (!season) {
    return (
      <SeasonEmptyState
        programs={programs}
        emphasisOptions={emphasisOptions}
        upcomingEvents={upcomingEvents}
      />
    );
  }
  return (
    <SeasonPopulated
      season={season}
      programs={programs}
      emphasisOptions={emphasisOptions}
      today={today}
      upcomingEvents={upcomingEvents}
    />
  );
}

/* ── Empty state: the create builder ──────────────────────────────── */

function SeasonEmptyState({
  programs,
  emphasisOptions,
  upcomingEvents,
}: {
  programs: SeasonRoadmapProgram[];
  emphasisOptions: readonly string[];
  upcomingEvents: UpcomingEvent[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<BlockDraft[]>([
    newDraft(programs, emphasisOptions),
  ]);
  // Optional goal: either an upcoming A-event ("event") or a free target date
  // ("theme"). Empty = no goal. `goalSel` holds the event id, "theme", or "".
  const [goalSel, setGoalSel] = useState<string>("");
  const [themeDate, setThemeDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const addRow = () => {
    setDrafts((d) =>
      d.length >= MAX_SEASON_BLOCKS
        ? d
        : [...d, newDraft(programs, emphasisOptions)],
    );
  };
  const removeRow = (i: number) => {
    setDrafts((d) => d.filter((_, idx) => idx !== i));
  };
  const patchRow = (i: number, patch: Partial<BlockDraft>) => {
    setDrafts((d) =>
      d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  };

  const buildGoal = () => {
    if (goalSel === "") return null;
    if (goalSel === "theme") {
      if (!themeDate) return null;
      return { goalType: "theme" as const, targetDate: themeDate };
    }
    const evt = upcomingEvents.find((e) => e.id === goalSel);
    if (!evt) return null;
    return {
      goalType: "event" as const,
      targetEventId: evt.id,
      targetDate: evt.eventDate,
    };
  };

  const onCreate = () => {
    setError(null);
    if (name.trim().length === 0) {
      setError("Give your season a name.");
      return;
    }
    if (drafts.length === 0) {
      setError("Add at least one block.");
      return;
    }
    const goal = buildGoal();
    startTransition(async () => {
      const res = await createSeason({
        name: name.trim(),
        blocks: drafts.map((b) => ({
          programId: b.programId,
          emphasis: b.emphasis,
          intentNote: b.intentNote.trim() === "" ? null : b.intentNote.trim(),
        })),
        ...(goal ? { goal } : {}),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section
      className={`cp-card ${styles.empty}`}
      data-testid="season-empty"
      aria-labelledby="season-empty-heading"
    >
      <h2 id="season-empty-heading" className={styles.emptyHeading}>
        Plan your training season
      </h2>
      <p className={styles.emptyLead}>
        A season is a flexible roadmap of training blocks &mdash; base &rarr;
        focus blocks &rarr; peak. Only your current block is scheduled
        day-by-day; future blocks are intentions you can change anytime.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="season-name">
          Season name
        </label>
        <input
          id="season-name"
          className={styles.input}
          type="text"
          value={name}
          maxLength={80}
          placeholder="e.g. Spring HYROX build"
          onChange={(e) => setName(e.target.value)}
          data-testid="season-name-input"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="season-goal">
          Goal (optional)
        </label>
        <select
          id="season-goal"
          className={styles.select}
          value={goalSel}
          disabled={pending}
          onChange={(e) => setGoalSel(e.target.value)}
          data-testid="season-goal-select"
        >
          <option value="">No specific goal</option>
          {upcomingEvents.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} — {e.eventDate}
            </option>
          ))}
          <option value="theme">A target date…</option>
        </select>
        {goalSel === "theme" && (
          <input
            className={styles.input}
            type="date"
            value={themeDate}
            disabled={pending}
            onChange={(e) => setThemeDate(e.target.value)}
            data-testid="season-goal-date"
            style={{ marginTop: 6 }}
          />
        )}
      </div>

      <ol className={styles.draftList} data-testid="season-draft-list">
        {drafts.map((row, i) => (
          <li key={i} className={styles.draftRow} data-testid="season-draft-row">
            <span className={styles.draftPos}>{i + 1}</span>
            <BlockFields
              row={row}
              programs={programs}
              emphasisOptions={emphasisOptions}
              idPrefix={`draft-${i}`}
              onChange={(patch) => patchRow(i, patch)}
              disabled={pending}
            />
            <button
              type="button"
              className={styles.rowRemove}
              onClick={() => removeRow(i)}
              disabled={pending || drafts.length === 1}
              aria-label={`Remove block ${i + 1}`}
              data-testid="season-draft-remove"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>

      <div className={styles.builderActions}>
        <button
          type="button"
          className="cp-btn"
          onClick={addRow}
          disabled={pending || drafts.length >= MAX_SEASON_BLOCKS}
          data-testid="season-add-row"
        >
          + Add block
        </button>
        <button
          type="button"
          className="cp-btn primary"
          onClick={onCreate}
          disabled={pending}
          data-testid="season-create"
        >
          {pending ? "Creating…" : "Create season"}
        </button>
      </div>

      {error && (
        <div role="alert" className={styles.error} data-testid="season-error">
          {error}
        </div>
      )}
    </section>
  );
}

/* ── Populated state: the roadmap rail ────────────────────────────── */

function SeasonPopulated({
  season,
  programs,
  emphasisOptions,
  today,
  upcomingEvents,
}: {
  season: ActiveSeason;
  programs: SeasonRoadmapProgram[];
  emphasisOptions: readonly string[];
  today: string;
  upcomingEvents: UpcomingEvent[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Which planned block (if any) is being edited inline, plus its working draft.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BlockDraft | null>(null);
  // Whether the goal editor is open.
  const [goalEditing, setGoalEditing] = useState(false);

  const nameById = new Map(programs.map((p) => [p.id, p.name]));
  const blocks = [...season.blocks].sort((a, b) => a.position - b.position);
  // The next block the user would start: the first PLANNED one. Only this card
  // gets the "Start block" CTA so the roadmap advances in order (sequential
  // activation; jumping ahead is out of scope for Phase 0).
  const nextPlannedId = blocks.find((b) => b.status === "planned")?.id ?? null;

  // Goal back-calc (ADR 0051 Phase 1): weeks to the goal date + whether the
  // remaining blocks fit the runway. Advisory only — show, don't block.
  const weeksToGoal = weeksUntil(today, season.goal?.targetDate ?? null);
  const remainingWeeks = remainingPlannedWeeks(blocks);
  const runway = goalRunwayStatus(weeksToGoal, remainingWeeks);

  const onRemove = (blockId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await removeSeasonBlock({ blockId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const onSaveEdit = (blockId: string, patch: BlockDraft) => {
    setError(null);
    startTransition(async () => {
      const res = await updateSeasonBlock({
        blockId,
        programId: patch.programId,
        emphasis: patch.emphasis,
        intentNote: patch.intentNote.trim() === "" ? null : patch.intentNote.trim(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditingId(null);
      setEditDraft(null);
      router.refresh();
    });
  };

  const onEditStart = (b: ActiveSeason["blocks"][number]) => {
    setError(null);
    setEditingId(b.id);
    setEditDraft({
      programId: b.programId,
      emphasis: b.emphasis,
      intentNote: b.intentNote ?? "",
    });
  };

  // Swap a planned block with its neighbour. Reordering is confined to the
  // planned tail — done/active blocks keep their position — so a move is only
  // offered when the adjacent block is also planned. The action takes the FULL
  // ordering and validates it's a permutation, so we send every id.
  const onMove = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    if (blocks[index]!.status !== "planned" || blocks[target]!.status !== "planned") return;
    const orderedBlockIds = blocks.map((b) => b.id);
    [orderedBlockIds[index], orderedBlockIds[target]] = [
      orderedBlockIds[target]!,
      orderedBlockIds[index]!,
    ];
    setError(null);
    startTransition(async () => {
      const res = await reorderSeasonBlocks({ seasonId: season.id, orderedBlockIds });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const onEnd = () => {
    setError(null);
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "End this season? Your logged sessions stay; the roadmap is archived.",
      );
      if (!ok) return;
    }
    startTransition(async () => {
      const res = await abandonSeason({ seasonId: season.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const onSetGoal = (goal: {
    goalType: "event" | "theme";
    targetDate?: string;
    targetEventId?: string;
  } | null) => {
    setError(null);
    startTransition(async () => {
      const res = await setSeasonGoal({ seasonId: season.id, goal });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setGoalEditing(false);
      router.refresh();
    });
  };

  return (
    <section
      className={`cp-card ${styles.populated}`}
      data-testid="season-roadmap"
      aria-label="Season roadmap"
    >
      <header className={styles.head}>
        <div>
          <div className={styles.eyebrow}>Season</div>
          <h2 className={styles.title}>{season.name}</h2>
          <div className={styles.goalRow}>
            {season.goal ? (
              <>
                <span className={styles.goalPill} data-testid="season-goal-pill">
                  ◎ {season.goal.eventName ?? season.goal.targetDate ?? "Goal"}
                  {weeksToGoal != null && (
                    <>
                      {" · "}
                      <b>{weeksToGoal} wk{weeksToGoal === 1 ? "" : "s"} out</b>
                    </>
                  )}
                </span>
                {runway === "over" && (
                  <span className={styles.goalWarn} data-testid="season-runway-warn">
                    ⚠ {remainingWeeks} wks of blocks vs {weeksToGoal} to your goal — tighten the plan.
                  </span>
                )}
                {runway === "tight" && (
                  <span className={styles.goalNote}>Tight fit — little slack before your goal.</span>
                )}
                <button
                  type="button"
                  className={styles.mini}
                  onClick={() => setGoalEditing((v) => !v)}
                  disabled={pending}
                  data-testid="season-goal-edit"
                >
                  ✎ Goal
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.mini}
                onClick={() => setGoalEditing((v) => !v)}
                disabled={pending}
                data-testid="season-goal-add"
              >
                ◎ Set a goal
              </button>
            )}
          </div>
          {goalEditing && (
            <GoalEditor
              upcomingEvents={upcomingEvents}
              hasGoal={!!season.goal}
              disabled={pending}
              onSave={onSetGoal}
              onCancel={() => setGoalEditing(false)}
            />
          )}
        </div>
        <button
          type="button"
          className="cp-btn danger"
          onClick={onEnd}
          disabled={pending}
          data-testid="season-end"
        >
          End season
        </button>
      </header>

      <div className={styles.rail} data-testid="season-rail">
        {blocks.map((b, i) => {
          const isActive = b.status === "active";
          const isDone = b.status === "done";
          const cardClass = [
            styles.bcard,
            isActive ? styles.active : "",
            isDone ? styles.done : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={b.id} className={styles.blk} data-testid="season-block">
              <div className={styles.connect} aria-hidden />
              <div className={cardClass} data-status={b.status}>
                <div className={styles.bcardTop}>
                  <span className={styles.wk}>Block {i + 1}</span>
                  <StatusBadge status={b.status} />
                </div>
                <div className={styles.prog} data-testid="season-block-program">
                  {nameById.get(b.programId) ?? b.programId}
                </div>
                {editingId === b.id && editDraft ? (
                  <div className={styles.editForm} data-testid="season-edit-form">
                    <BlockFields
                      row={editDraft}
                      programs={programs}
                      emphasisOptions={emphasisOptions}
                      idPrefix={`edit-${b.id}`}
                      onChange={(patch) =>
                        setEditDraft((d) => (d ? { ...d, ...patch } : d))
                      }
                      disabled={pending}
                    />
                    <div className={styles.addFormActions}>
                      <button
                        type="button"
                        className="cp-btn"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft(null);
                        }}
                        disabled={pending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="cp-btn primary"
                        onClick={() => onSaveEdit(b.id, editDraft)}
                        disabled={pending}
                        data-testid="season-edit-save"
                      >
                        {pending ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {b.templateRef && (
                      <div className={styles.tmpl}>{b.templateRef}</div>
                    )}
                    <span
                      className={styles.chip}
                      data-testid="season-block-emphasis"
                    >
                      {emphasisLabel(b.emphasis)}
                    </span>
                    {b.intentNote && <div className={styles.why}>{b.intentNote}</div>}
                    {biasFloorNote(b.emphasis) && (
                      <div className={styles.floorNote} data-testid="season-floor-note">
                        🛡 {biasFloorNote(b.emphasis)}
                      </div>
                    )}
                    {b.status === "planned" && (
                      <div className={styles.ctrls}>
                        {b.id === nextPlannedId && (
                          <a
                            className={styles.startBtn}
                            href={`/app/program?program=${encodeURIComponent(
                              b.programId,
                            )}&seasonBlockId=${encodeURIComponent(b.id)}`}
                            data-testid="season-block-start"
                          >
                            Start block →
                          </a>
                        )}
                        <button
                          type="button"
                          className={styles.mini}
                          onClick={() => onMove(i, -1)}
                          disabled={pending || blocks[i - 1]?.status !== "planned"}
                          aria-label="Move block earlier"
                          data-testid="season-block-up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.mini}
                          onClick={() => onMove(i, 1)}
                          disabled={pending || blocks[i + 1]?.status !== "planned"}
                          aria-label="Move block later"
                          data-testid="season-block-down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={styles.mini}
                          onClick={() => onEditStart(b)}
                          disabled={pending}
                          aria-label="Edit block"
                          data-testid="season-block-edit"
                        >
                          ✎ Edit
                        </button>
                        <button
                          type="button"
                          className={styles.mini}
                          onClick={() => onRemove(b.id)}
                          disabled={pending}
                          aria-label="Remove block"
                          data-testid="season-block-remove"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        <AddBlockCard
          seasonId={season.id}
          programs={programs}
          emphasisOptions={emphasisOptions}
          full={blocks.length >= MAX_SEASON_BLOCKS}
          lastProgramId={
            [...blocks].reverse().find((b) => b.status === "active" || b.status === "done")
              ?.programId ?? null
          }
        />
      </div>

      {error && (
        <div role="alert" className={styles.error} data-testid="season-error">
          {error}
        </div>
      )}

      <div className={styles.foot}>
        This is a flexible plan. Only your current block is scheduled day-by-day;
        future blocks are intentions that adjust as your training does.
      </div>
    </section>
  );
}

function AddBlockCard({
  seasonId,
  programs,
  emphasisOptions,
  full,
  lastProgramId,
}: {
  seasonId: string;
  programs: SeasonRoadmapProgram[];
  emphasisOptions: readonly string[];
  full: boolean;
  lastProgramId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<BlockDraft>(() =>
    newDraft(programs, emphasisOptions),
  );
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Advisory: propose the best-fitting program for the chosen emphasis, biased
  // away from what was just run (ADR 0051 A4). Fills the program; the user can
  // still override. Only suggests a program the picker actually offers.
  const onSuggest = () => {
    const res = selectNextBlock(emphasisToSlot(row.emphasis as SeasonEmphasis), {
      lastProgramId,
    });
    const pick = res.ranked.find((r) => programs.some((p) => p.id === r.candidate.programId));
    if (!pick) {
      setSuggestion("No confident suggestion — pick what you like.");
      return;
    }
    setRow((r) => ({ ...r, programId: pick.candidate.programId }));
    setSuggestion(pick.reason);
  };

  const onAdd = () => {
    setError(null);
    startTransition(async () => {
      const res = await addSeasonBlock({
        seasonId,
        programId: row.programId,
        emphasis: row.emphasis,
        intentNote: row.intentNote.trim() === "" ? null : row.intentNote.trim(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setRow(newDraft(programs, emphasisOptions));
      router.refresh();
    });
  };

  if (full) {
    return (
      <div className={styles.add}>
        <div className={styles.addcard}>
          <div className={styles.addFull}>
            Season is full ({MAX_SEASON_BLOCKS} blocks).
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.add}>
      <div className={styles.addcard}>
        {open ? (
          <div className={styles.addForm} data-testid="season-add-form">
            <BlockFields
              row={row}
              programs={programs}
              emphasisOptions={emphasisOptions}
              idPrefix="add"
              onChange={(patch) => setRow((r) => ({ ...r, ...patch }))}
              disabled={pending}
            />
            <button
              type="button"
              className={styles.suggestBtn}
              onClick={onSuggest}
              disabled={pending}
              data-testid="season-suggest"
            >
              ✨ Suggest a fit
            </button>
            {suggestion && (
              <div className={styles.suggestReason} data-testid="season-suggest-reason">
                {suggestion}
              </div>
            )}
            <div className={styles.addFormActions}>
              <button
                type="button"
                className="cp-btn"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cp-btn primary"
                onClick={onAdd}
                disabled={pending}
                data-testid="season-add-confirm"
              >
                {pending ? "Adding…" : "Add"}
              </button>
            </div>
            {error && (
              <div role="alert" className={styles.error}>
                {error}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className={styles.addTrigger}
            onClick={() => setOpen(true)}
            data-testid="season-add-block"
          >
            + Add block
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Goal editor (header "Set / Edit goal") ───────────────────────── */

function GoalEditor({
  upcomingEvents,
  hasGoal,
  disabled,
  onSave,
  onCancel,
}: {
  upcomingEvents: UpcomingEvent[];
  hasGoal: boolean;
  disabled?: boolean;
  onSave: (
    goal: { goalType: "event" | "theme"; targetDate?: string; targetEventId?: string } | null,
  ) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState<string>("");
  const [themeDate, setThemeDate] = useState<string>("");

  const save = () => {
    if (sel === "") return;
    if (sel === "theme") {
      if (!themeDate) return;
      onSave({ goalType: "theme", targetDate: themeDate });
      return;
    }
    const evt = upcomingEvents.find((e) => e.id === sel);
    if (!evt) return;
    onSave({ goalType: "event", targetEventId: evt.id, targetDate: evt.eventDate });
  };

  return (
    <div className={styles.goalEditor} data-testid="season-goal-editor">
      <select
        className={styles.select}
        value={sel}
        disabled={disabled}
        onChange={(e) => setSel(e.target.value)}
        aria-label="Goal"
      >
        <option value="">Choose a goal…</option>
        {upcomingEvents.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} — {e.eventDate}
          </option>
        ))}
        <option value="theme">A target date…</option>
      </select>
      {sel === "theme" && (
        <input
          className={styles.input}
          type="date"
          value={themeDate}
          disabled={disabled}
          onChange={(e) => setThemeDate(e.target.value)}
          aria-label="Target date"
        />
      )}
      <div className={styles.addFormActions}>
        <button type="button" className="cp-btn" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
        {hasGoal && (
          <button
            type="button"
            className="cp-btn"
            onClick={() => onSave(null)}
            disabled={disabled}
            data-testid="season-goal-clear"
          >
            Clear goal
          </button>
        )}
        <button
          type="button"
          className="cp-btn primary"
          onClick={save}
          disabled={disabled}
          data-testid="season-goal-save"
        >
          Save goal
        </button>
      </div>
    </div>
  );
}

/* ── Shared block field group (program + emphasis + note) ─────────── */

function BlockFields({
  row,
  programs,
  emphasisOptions,
  idPrefix,
  onChange,
  disabled,
}: {
  row: BlockDraft;
  programs: SeasonRoadmapProgram[];
  emphasisOptions: readonly string[];
  idPrefix: string;
  onChange: (patch: Partial<BlockDraft>) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.fields}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-program`}>
          Program
        </label>
        <select
          id={`${idPrefix}-program`}
          className={styles.select}
          value={row.programId}
          disabled={disabled}
          onChange={(e) => onChange({ programId: e.target.value })}
        >
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-emphasis`}>
          Emphasis
        </label>
        <select
          id={`${idPrefix}-emphasis`}
          className={styles.select}
          value={row.emphasis}
          disabled={disabled}
          onChange={(e) => onChange({ emphasis: e.target.value })}
        >
          {emphasisOptions.map((v) => (
            <option key={v} value={v}>
              {emphasisLabel(v)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-note`}>
          Why (optional)
        </label>
        <input
          id={`${idPrefix}-note`}
          className={styles.input}
          type="text"
          value={row.intentNote}
          maxLength={280}
          placeholder="One-line intent"
          disabled={disabled}
          onChange={(e) => onChange({ intentNote: e.target.value })}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "done"
      ? "Done ✓"
      : status === "active"
        ? "● Active"
        : status === "skipped"
          ? "Skipped"
          : "Planned";
  return (
    <span
      className={`${styles.status} ${
        status === "active" ? styles.statusActive : ""
      }`}
      data-testid="season-block-status"
    >
      {label}
    </span>
  );
}
