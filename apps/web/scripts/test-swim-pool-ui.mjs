import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

// Reuse Vitest's locked compiler; no app server, environment files or HTTP backend.
const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve("vitest/package.json")).resolve("vite"));
const { build } = viteRequire("esbuild");
const root = fileURLToPath(new URL("..", import.meta.url));
const stages = [];
let browser, stage = "bundle", status = "failed", code = "unexpected";
try {
  const output = await build({
    stdin: {
      contents: `
        import React, { useState } from "react";
        import { createRoot, hydrateRoot } from "react-dom/client";
        import { renderToString } from "react-dom/server.browser";
        import { PoolEditor } from "./src/components/swim/PoolEditor";
        import { SetupForm } from "./src/components/swim/SetupForm";
        import { SwimImportConnection } from "./src/components/swim/SwimImportConnection";
        import { CourseImportForm } from "./src/components/swim/CourseImportForm";
        import { CourseWorkoutEditor } from "./src/components/swim/CourseWorkoutEditor";
        import { SwimHub } from "./src/components/swim/SwimHub";
        import { WorkoutScreen } from "./src/components/swim/WorkoutScreen";
        import { SwimRehabEditor } from "./src/components/swim/SwimRehabEditor";
        import { SwimRehabWorkouts } from "./src/components/swim/SwimRehabWorkouts";
        import { compileLibraryRehab } from "./src/lib/rehab-protocols/prescription";
        import { workoutPresentation } from "./src/lib/swim/presentation";
        import { RecordingMatcher } from "./src/components/swim/RecordingMatcher";
        import { RecordingOutcome } from "./src/components/swim/RecordingOutcome";
        import { ProgramBuilder } from "./src/components/program/ProgramBuilder";
        import { ProgramPicker } from "./src/components/program/ProgramPicker";
        import { ProgramsOverview } from "./src/components/program/ProgramsOverview";
        import { ProgramRecommendationsBanner } from "./src/components/today/ProgramRecommendationsBanner";
        import { ProgramProgress } from "./src/components/stats/ProgramProgress";
        import { TmSuggestionBanner } from "./src/components/today/TmSuggestionBanner";
        import { TrainingWeek } from "./src/components/program/TrainingWeek";
        import { ThisWeekRail } from "./src/components/plan/ThisWeekRail";
        import { ScheduleRestoreButton } from "./src/components/program/ScheduleRestoreButton";
        import { TrashItemRow } from "./src/components/trash/TrashItemRow";
        import { DeleteBlockMenu } from "./src/components/trash/DeleteBlockMenu";
        import { PlanProgramActions } from "./src/components/plan/PlanProgramActions";
        import { RehabProtocolsClient } from "./src/components/rehab-protocols/RehabProtocolsClient";
        import { DeloadWeekCard } from "./src/components/plan/DeloadWeekCard";
        import { FocusStripLogger } from "./src/components/session/FocusStripLogger";
        import { SessionWorkArea } from "./src/components/session/SessionWorkArea";
        import { FinishSessionBar } from "./src/components/session/FinishSessionBar";
        import { CardioLogForm } from "./src/components/session/CardioLogForm";
        import { flushOutbox } from "./src/lib/offline/flusher";
        import { listPending } from "./src/lib/offline/outbox";
        import { TmSection } from "./src/components/training-maxes/TmSection";
        import { SessionLoggingStateProvider, useSessionLoggingState } from "./src/components/session/SessionLoggingState";
        import { compileAuthoredWorkout } from "@hta/domain";
        import { greenProtocolEngine } from "@hta/green";
        import { groupPrescriptionByMovement } from "./src/lib/sessions/movement-grouping";
        import { getMovementSwapLoadContext, swapMovementInPrescription, SWAP_PROGRAM_LOAD_REQUIRED_WARNING } from "./src/lib/sessions/prescription-mutations";
        import { optimisticLogFromFormData, mergeOptimisticSets } from "./src/lib/sessions/optimistic-log";
        import { syntheticCourse } from "./src/lib/swim/__tests__/course-fixtures";
        import { planPrivateSwimCourse } from "./src/lib/swim/course-planning";
        import styles from "./src/components/swim/Swim.module.css";
        import "./src/app/globals.css";
        const root = createRoot(document.getElementById("root"));
        const long = { numerator: 50, denominator: 1, unit: "m" };
        const short = { numerator: 25, denominator: 1, unit: "m" };
        window.courseSource = syntheticCourse(); window.courseMode = "success"; window.courseCalls = []; window.destinations = [];
        window.courseSource.weeks.forEach((week, index) => week.workouts.forEach(workout => workout.title = "Week " + (index + 1)));
        window.sourceDrill = "Alternate relaxed swimming and kicking within each repeat.";
        window.courseSource.weeks[0].workouts[0].sections[0].items[0].drill = window.sourceDrill;
        const prepared = planPrivateSwimCourse({
          source: window.courseSource, setup: {
            course: long, goal: "endurance", experience: "recreational", knownStrokes: ["freestyle"],
            equipment: [], recentComfortableLengths: 4, sessionBudgetMinutes: null,
          }, startDate: "2026-09-14", weekdays: [1, 4], poolChoices: [],
        });
        window.previewCourse = async (form) => {
          window.courseCalls.push("preview");
          if (window.courseMode === "delay") await new Promise(resolve => window.resolveCourse = resolve);
          if (window.courseMode === "error") return { error: "Review the selected pool.", errorCode: "validation" };
          return { ok: true, preview: { id: "synthetic-course", title: window.courseSource.title, plan: prepared.preview,
            totals: [{ key: "course-0-0", week: 1, workout: 1, reported: 999, calculated: 350 }],
            revision: "a".repeat(32), overlaps: [{ id: "synthetic-primary", source: "primary", programId: "synthetic-program",
              date: "2026-09-14", title: "Strength", state: "scheduled" }] } };
        };
        window.saveCourse = async (form, id) => {
          window.courseCalls.push("save");
          window.courseConfirmed = id === "synthetic-course" && form.get("reviewed") === "on" &&
            form.get("acceptSetTotals") === "on" && form.get("acceptOverlap") === "on";
          if (window.courseMode === "error") return { error: "The plan changed. Review it again.", errorCode: "validation" };
          return { ok: true, planId: "00000000-0000-4000-8000-000000000004" };
        };
        window.previewCourseEdit = async input => {
          window.courseCalls.push("edit-preview"); window.editedWorkout = input.workout;
          return { ok: true, preview: { id: "synthetic-edit", before: "350 m", after: "250 m", plan: prepared.preview } };
        };
        window.saveCourseEdit = async () => { window.courseCalls.push("edit-save"); return { ok: true }; };
        window.requests = []; window.applied = []; window.mode = "success";
        window.previewPool = async (input) => {
          window.requests.push(input);
          if (window.mode === "delay") await new Promise(resolve => window.resolvePreview = resolve);
          if (window.mode === "error") return { error: "This repeat does not fit the selected pool.", errorCode: "validation" };
          return { ok: true, preview: { ...input, id: "synthetic-preview", courseLabel: "25 m",
            changes: [{ id: "workout", date: "2026-09-14", beforeCourse: "50 m", afterCourse: "25 m",
              distance: "400 m", beforeLengths: 8, afterLengths: 16 }] } };
        };
        let key = 0;
        const circuitWorkout = { id: "fixture-workout", name: "Mixed", weekday: 0, parts: [
          { id: "fixture-run", kind: "cardio", movementId: "run", modality: "run", intensity: "z2",
            repeats: 2, notes: "", intervals: [{ id: "fixture-interval", label: "Run", effort: "easy", target: { kind: "time", seconds: 60 } }] },
          { id: "fixture-circuit", kind: "circuit", name: "Circuit", rounds: 2,
            movements: ["a", "b"].map(id => ({ id: "station-" + id, movementId: id, role: "main",
              sets: 1, dose: { kind: "reps", reps: 5 }, weightKg: 20, restSeconds: 0, notes: "" })) },
        ] };
        const circuitCatalog = [
          { id: "run", slug: "run-easy-z2", displayName: "Run", pattern: "cardio", modality: "run" },
          { id: "a", slug: "station-a", displayName: "Station A", pattern: "squat" },
          { id: "b", slug: "station-b", displayName: "Station B", pattern: "push" },
        ];
        const circuitGroups = groupPrescriptionByMovement(compileAuthoredWorkout(circuitWorkout, circuitCatalog));
        function CircuitFixture({ solo }) {
          const [covered, setCovered] = useState(new Set());
          const save = async form => {
            const index = Number(form.get("prescriptionItemIndex"));
            window.circuitWrites.push(index);
            setCovered(previous => new Set([...previous, index]));
            const outcome = await new Promise(resolve => { window.circuitPending.push(resolve); });
            if (outcome?.error) setCovered(previous => new Set([...previous].filter(value => value !== index)));
            return outcome ?? { ok: true };
          };
          const groups = solo ? circuitGroups.slice(0, 1).map(group => ({
            ...group, items: group.items.map(({ circuit, ...item }) => item),
          })) : circuitGroups;
          return <main><FocusStripLogger sessionId={"circuit-" + key} groups={groups}
            setsByMovement={new Map()} tmBySlug={{}} oneRmBySlug={{}} loggedItemIndices={covered}
            skippedItemIndices={new Set()} loggedSetIdByItemIndex={{}} priorBests={{}}
            addStrengthSet={save} updateStrengthSet={async () => { throw new Error("Unexpected update"); }}
            hapticsEnabled={false} timerSoundEnabled={false} restTimerEnabled={false} /></main>;
        }
        window.showCircuit = (solo = false) => {
          window.circuitWrites = []; window.circuitPending = [];
          window.settleCircuitSave = outcome => window.circuitPending.shift()(outcome);
          root.render(<CircuitFixture key={++key} solo={solo} />);
        };
        const fullCircuitCatalog = circuitCatalog.map((movement, index) => ({
          ...movement, id: "00000000-0000-4000-8000-" + String(index + 21).padStart(12, "0"),
        }));
        const fullCircuitWorkout = { ...circuitWorkout, id: "00000000-0000-4000-8000-000000000024",
          parts: circuitWorkout.parts.map((part, index) => ({ ...part,
            id: "00000000-0000-4000-8000-" + String(index + 25).padStart(12, "0"),
            ...(part.kind === "cardio" ? { movementId: fullCircuitCatalog[0].id }
              : { movements: part.movements.map((movement, position) => ({ ...movement,
                  id: "00000000-0000-4000-8000-" + String(position + 27).padStart(12, "0"),
                  movementId: fullCircuitCatalog[position + 1].id })) }),
          })),
        };
        const fullCircuitPrescription = compileAuthoredWorkout(fullCircuitWorkout, fullCircuitCatalog);
        function FullLoggingProbe() {
          const state = useSessionLoggingState();
          return <output data-testid="full-remaining" data-planned={state.remainingPlannedSets}
            data-strength={String(state.hasStrengthSets)}>{state.remainingRequiredSets}</output>;
        }
        window.showFullCircuit = (deferFirstSave = false) => {
          const sessionId = crypto.randomUUID();
          const fixtureKey = ++key, serverSets = [], serverCardio = [];
          let snapshotNumber = 0;
          window.circuitWrites = [];
          window.beforeOutboxCount = null;
          const unexpected = async () => { throw new Error("Unexpected session mutation"); };
          window.logFullStrength = async form => {
            window.circuitWrites.push(Number(form.get("prescriptionItemIndex")));
            const id = crypto.randomUUID();
            const log = optimisticLogFromFormData(form, String(form.get("clientLogId")));
            serverSets.push(...mergeOptimisticSets([], [{ ...log, serverId: id }]));
            if (deferFirstSave && window.circuitWrites.length === 1) {
              await new Promise(resolve => window.resolveFullStrength = resolve);
            }
            return { ok: true, set: { id } };
          };
          window.logFullCardio = async () => {
            serverCardio.push({ id: crypto.randomUUID(), blockIndex: 1, durationSec: 120 });
            return { ok: true };
          };
          window.deleteFullSet = async form => {
            const index = serverSets.findIndex(set => set.id === form.get("id"));
            if (index < 0) throw new Error("Synthetic set missing");
            serverSets.splice(index, 1);
          };
          window.refreshFullCircuit = (snapshot = { sets: [...serverSets], cardio: [...serverCardio] }) =>
            root.render(<main key={fixtureKey} data-testid="full-work-area" data-snapshot={++snapshotNumber}>
            <SessionLoggingStateProvider key={sessionId}
            initialHasStrengthSets={snapshot.sets.length > 0} initialLoggedCardioItemIndices={snapshot.cardio.map(log => log.blockIndex - 1)}
            initialLoggedStrengthClientIds={snapshot.sets.flatMap(set => set.client_log_id ? [set.client_log_id] : [])}
            initialUnloggedStrengthCount={4 - snapshot.sets.length}
            initialUnloggedRequiredIndices={[0,1,2,3,4].filter(index => !snapshot.sets.some(set => set.prescription_item_index === index)
              && !snapshot.cardio.some(log => log.blockIndex === index + 1))}>
            <FullLoggingProbe />
            <SessionWorkArea sessionId={sessionId} isComplete={false} performedAt="2026-09-14T12:00:00Z"
              sets={snapshot.sets} tmBySlug={{}} oneRmBySlug={{}} lastSetHints={{}} priorBests={{}}
              plannedSessionId="00000000-0000-4000-8000-000000000029" prescription={fullCircuitPrescription}
              loggedItemIndices={snapshot.sets.map(set => set.prescription_item_index)}
              loggedSetIdByItemIndex={Object.fromEntries(snapshot.sets.map(set => [set.prescription_item_index, set.id]))} swapAction={unexpected}
              fillFromPlan={unexpected} updateStrengthSet={unexpected}
              hapticsEnabled={false} timerSoundEnabled={false} restTimerEnabled={false}
              addStrengthSet={window.logFullStrength}
              authoredCardio={{ units: "metric", logs: snapshot.cardio, action: window.logFullCardio }} />
          </SessionLoggingStateProvider></main>);
          window.captureStaleCardioSnapshot = (pauseAfterCleanup = true) => {
            const snapshot = { sets: [...serverSets], cardio: [...serverCardio] };
            window.refreshStaleFullCircuit = () => window.refreshFullCircuit(snapshot);
            if (!pauseAfterCleanup) return;
            window.beforeOutboxCount = async () => {
              window.beforeOutboxCount = null;
              window.refreshFullCircuit(snapshot);
              await new Promise(resolve => window.resolveFullCount = resolve);
            };
          };
          window.refreshFullCircuit();
        };
        window.homeCalls = [];
        window.showHomeWeek = () => {
          history.replaceState(null, "", "/");
          const session = {
            id: "primary-home", weekIndex: 0, dayIndex: 0, date: "2026-09-14", title: "Strength A",
            isCardio: false, isStrength: true, isRehab: false, done: false, inProgress: false,
            skipped: false, slot: "single", items: [], estDurationMin: 30, notes: null, completedSessionId: null,
          };
          root.render(<main key={++key} style={{ maxWidth: 380, padding: 12 }}>
            <TrainingWeek today="2026-09-14" primaryPreviewIds={[session.id]} entries={[
              { id: session.id, source: "primary", programId: "home-block", date: session.date, title: session.title, state: "scheduled" },
              { id: "swim-home", source: "swim", programId: "home-swim-plan", date: session.date, title: "Swim A", state: "scheduled" },
            ]} />
            <ThisWeekRail sessions={[session]} today="2026-09-14" currentWeekIndex={0} weeks={2}
              logHrefBase="/app/sessions/start" showRail={false}
              moveAction={() => window.homeCalls.push("move")} skipAction={() => window.homeCalls.push("skip")}
              unskipAction={() => window.homeCalls.push("unskip")}
              updateNotesAction={async (id, notes) => { window.homeCalls.push(["notes", id, notes]); return { ok: true }; }}
              startSessionAction={() => window.homeCalls.push("start")} />
          </main>);
        };
        window.programCalls = []; window.programMode = "success";
        window.showProgramsOverview = (activity, includeHybrid = false) => {
          const identity = value => "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
          window.destinations = [];
          const programs = [
            { id: identity(101), kind: "strength", name: "Strength", startedOn: "2026-09-21", weeks: 4, editable: true },
            { id: identity(102), kind: "running", name: "Running", startedOn: "2026-09-21", weeks: 6, editable: true },
            ...(includeHybrid ? [{ id: identity(103), kind: "hybrid", name: "Running-and-stations-with-strength-and-rehab", startedOn: "2026-09-21", weeks: 8, editable: true }] : []),
          ];
          const entries = [
            { id: identity(201), source: "primary", programId: identity(101), date: "2026-09-21", title: "Upper A" },
            { id: identity(202), source: "primary", programId: identity(101), date: "2026-09-24", title: "Upper B" },
            { id: identity(203), source: "primary", programId: identity(102), date: "2026-09-22", title: "Easy run" },
            { id: identity(204), source: "primary", programId: identity(102), date: "2026-09-25", title: "Intervals" },
            { id: identity(205), source: "swim", programId: identity(104), date: "2026-09-23", title: "Swim A" },
            { id: identity(206), source: "swim", programId: identity(104), date: "2026-09-26", title: "Swim B" },
            ...(includeHybrid ? [{ id: identity(207), source: "primary", programId: identity(103), date: "2026-09-26", title: "Run and stations" }] : []),
          ].map(entry => ({ ...entry, state: "scheduled" }));
          root.render(<main key={++key} style={{ padding: 12 }}><ProgramsOverview programs={programs}
            activity={activity} today="2026-09-21" entries={entries} swimHref="/app/swim" hasSwimPlans /></main>);
        };
        window.showOwnedRecommendation = () => {
          root.render(<main key={++key} style={{ padding: 12, maxWidth: 680 }}><ProgramRecommendationsBanner
            programNames={{ "00000000-0000-4000-8000-000000000103": "Weekend hybrid" }}
            recommendations={[{ id: "00000000-0000-4000-8000-000000000301", kind: "deload",
              blockId: "00000000-0000-4000-8000-000000000103", occurrenceKey: "recovery-boundary",
              title: "Recovery week", detail: "Review the next week of this program." }]}
            dismissAction={async () => ({ ok: false, error: "Could not dismiss this recommendation. Try again." })} /></main>);
        };
        window.previewProgram = async input => {
          window.programCalls.push({ action: "preview", input });
          return { ok: true, preview: { id: "synthetic-review", revision: "a".repeat(32),
            dates: [{ date: "2026-09-14", title: "Run", itemCount: 1 }], overlaps: [], plannedRest: [],
            replaces: null, replacesBlockId: null, preserved: 0 } };
        };
        window.saveProgram = async (...args) => {
          window.programCalls.push({ action: "save", args });
          return window.programMode === "stale" ? { ok: false, error: "Your program or schedule changed. Review it again." }
            : { ok: true, blockId: "00000000-0000-4000-8000-000000000004" };
        };
        window.showProgramEdit = () => {
          const workoutId = "00000000-0000-4000-8000-000000000001";
          const movementId = "00000000-0000-4000-8000-000000000002";
          root.render(<main><ProgramBuilder key={++key} today="2026-09-14" commitments={[]}
            editBlockId="00000000-0000-4000-8000-000000000004" workoutId={workoutId}
            plannedSessionId="00000000-0000-4000-8000-000000000005" initialStartDate="2026-09-14"
            catalog={[{ id: movementId, slug: "run-easy-z2", displayName: "Easy run", pattern: "cardio", modality: "run" }]}
            initial={{ version: 1, activity: "running", name: "Running fixture", weeks: 2, workouts: [{
              id: workoutId, name: "Run", weekday: 0, parts: [{ id: "00000000-0000-4000-8000-000000000003",
                kind: "cardio", movementId, modality: "run", intensity: "z2", repeats: 2, notes: "",
                intervals: [{ id: "00000000-0000-4000-8000-000000000006", label: "Run", effort: "easy",
                  target: { kind: "time", seconds: 60 } }] }],
            }] }} /></main>);
        };
        window.showCourseHub = () => root.render(<main className={styles.page}><SwimHub key={++key}
          setupEnabled={false} plans={[]} plan={{
            id: "00000000-0000-4000-8000-000000000001", revision: 1, status: "active",
            imported: { title: window.courseSource.title }, goal: "Endurance", course: "50 m",
            dates: "2026-09-14 – 2026-09-27", today: "2026-09-14",
            proposals: [], analytics: { weeks: [], bests: [], benchmarks: [] },
            workouts: prepared.preview.weeks.flatMap(week => week.workouts.map(workout => ({
              ...workout, id: workout.slotId, week: week.week, status: "Scheduled", provisional: false,
            }))),
          }} /></main>);
        window.showWorkout = (generated = false) => {
          const issued = prepared.workouts[0].definition.issued;
          const view = workoutPresentation({ ...issued, budget: { ...issued.budget, minutes: 60 },
            snapshot: { ...issued.snapshot, versions: { ...issued.snapshot.versions,
              generator: generated ? "swim-gen-1" : issued.snapshot.versions.generator } },
          });
          const title = prepared.preview.weeks[0].workouts[0].title;
          root.render(<main className={styles.page}><h1>{title}</h1><WorkoutScreen key={++key} workout={{
            ...view, title, id: "00000000-0000-4000-8000-000000000002", revision: 1,
            sessionId: null, status: "scheduled", planStatus: "active", date: "2026-09-14",
            provisional: false, deleted: false, result: null,
          }} /></main>);
        };
        window.matchMode = "success"; window.matchCalls = []; window.findCalls = [];
        window.findWorkouts = async date => {
          window.findCalls.push(date);
          if (window.matchMode === "delay") await new Promise(resolve => window.resolveFind = resolve);
          return { ok: true, value: [{
            id: "00000000-0000-4000-8000-000000000002", revision: 3, date,
            title: "Synthetic endurance workout", distance: "350 m", pool: "50 m",
            plan: "Synthetic course · 2026-09-14", slot: "AM",
          }] };
        };
        window.saveMatch = async input => {
          window.matchCalls.push(input);
          return window.matchMode === "error" ? { ok: false, error: "The match could not be saved." } : { ok: true, value: input.requestId };
        };
        window.outcomeCalls = []; window.outcomeMode = "success";
        window.saveOutcome = async input => {
          window.outcomeCalls.push(input);
          if (window.outcomeMode === "delay") await new Promise(resolve => window.resolveOutcome = resolve);
          return window.outcomeMode === "error" ? { ok: false, error: "The outcome could not be saved." }
            : { ok: true, value: input.requestId };
        };
        window.showOutcome = (retained = false) => root.render(<main className={styles.page}>
          <RecordingOutcome key={++key} workoutId="00000000-0000-4000-8000-000000000002"
            workoutTitle={retained ? "Week 1 A: steady swimming" : "steady swimming"} origin="sessions"
            matchId={retained ? null : "00000000-0000-4000-8000-000000000003"} workoutRevision={3}
            expectedOutcomeId={retained ? "00000000-0000-4000-8000-000000000004" : null}
            current={null} enabled={!retained} canRemove={retained} needsReview={retained} otherMatch={false} />
        </main>);
        window.showMatcher = (matched = false, enabled = true) => root.render(<main className={styles.page}>
          <RecordingMatcher key={++key} importId="00000000-0000-4000-8000-000000000001" enabled={enabled}
            expectedMatchId={matched ? "00000000-0000-4000-8000-000000000003" : null}
            current={matched ? { importId: "00000000-0000-4000-8000-000000000001",
              workoutId: "00000000-0000-4000-8000-000000000002", title: "Synthetic endurance workout", date: "2026-09-15" } : null} />
        </main>);
        window.showCourse = () => root.render(<main className={styles.page}><CourseImportForm key={++key} today="2026-09-14" /></main>);
        let courseHydrationRoot;
        window.showServerCourse = () => {
          document.getElementById("root").hidden = true;
          const container = document.createElement("main");
          container.id = "server-course";
          container.className = styles.page;
          container.innerHTML = renderToString(<CourseImportForm today="2026-09-14" />);
          document.body.appendChild(container);
        };
        window.hydrateCourse = () => {
          courseHydrationRoot = hydrateRoot(document.getElementById("server-course"), <CourseImportForm today="2026-09-14" />);
        };
        window.removeServerCourse = () => {
          courseHydrationRoot.unmount();
          document.getElementById("server-course").remove();
          document.getElementById("root").hidden = false;
        };
        window.showCourseEdit = () => root.render(<main className={styles.page}><CourseWorkoutEditor key={++key} context={{
          planId: "00000000-0000-4000-8000-000000000001", revision: 1,
          workoutId: "00000000-0000-4000-8000-000000000002", workoutRevision: 1,
          workout: window.courseSource.weeks[0].workouts[0],
        }} /></main>);
        window.importMode = "success"; window.clipboardMode = "success";
        window.importKey = "swim_" + "a".repeat(43); window.connectCalls = 0; window.disconnectCalls = [];
        window.connection = {
          id: "00000000-0000-4000-8000-000000000003",
          created_at: "2026-09-14T12:00:00Z", revoked_at: null,
        };
        window.connectDashboard = async () => {
          window.connectCalls++;
          if (window.importMode === "delay") await new Promise(resolve => window.resolveConnect = resolve);
          if (window.importMode === "throw") throw new Error("Synthetic unavailable action");
          if (window.importMode === "error") return { ok: false, error: "Could not create the key." };
          return { ok: true, id: window.connection.id, key: window.importKey };
        };
        window.disconnectDashboard = async (id) => {
          window.disconnectCalls.push(id);
          if (window.importMode === "error") return { ok: false, error: "Could not disconnect." };
          return { ok: true };
        };
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          writeText: async value => {
            if (window.clipboardMode === "error") throw new Error("Synthetic clipboard refusal");
            window.copiedKey = value;
          },
        } });
        window.showConnection = (enabled, active) => root.render(
          <main className={styles.page}><SwimImportConnection key={++key}
            enabled={enabled} connection={active ? window.connection : null} /></main>
        );
        const rehabProtocol = {
          id: "00000000-0000-4000-8000-000000000041", name: "Shoulder rehab", revision: 2,
          items: [
            { movementId: "00000000-0000-4000-8000-000000000042", movementName: "Shoulder rotation", sets: 2, reps: 8, targetWeightKg: 2, side: "left" },
            { movementId: "00000000-0000-4000-8000-000000000043", movementName: "Scapular raise", sets: 2, reps: 10, targetWeightKg: 2, side: "both" },
          ],
          links: [{ id: "pair", name: "Shoulder pair", members: [
            "00000000-0000-4000-8000-000000000042", "00000000-0000-4000-8000-000000000043",
          ] }],
        };
        const rehabOrigin = {
          version: 1, planId: "00000000-0000-4000-8000-000000000044",
          workoutId: "00000000-0000-4000-8000-000000000045", scheduledDate: "2026-09-14",
          protocolId: rehabProtocol.id, protocolRevision: rehabProtocol.revision, protocolName: rehabProtocol.name,
        };
        const rehabPrescription = {
          items: compileLibraryRehab(rehabProtocol, "swim:" + rehabOrigin.workoutId), meta: { swimRehab: rehabOrigin },
        };
        let rehabSessionId;
        window.rehabProtocol = rehabProtocol;
        window.rehabLongName = "Shoulder-" + "rehab".repeat(20);
        window.saveRehabAttachments = async input => {
          window.rehabCalls.push(input);
          if (window.rehabMode === "delay") return await new Promise(resolve => window.resolveRehab = resolve);
          return { ok: true, protocolIds: input.protocolIds };
        };
        window.startRehab = async input => {
          window.rehabCalls.push(input);
          if (window.rehabMode === "delay") return await new Promise(resolve => window.resolveRehab = resolve);
          return { ok: true, sessionId: rehabSessionId };
        };
        window.showRehabAttachments = () => {
          window.rehabCalls = []; window.rehabMode = "delay";
          root.render(<main className={styles.page}><SwimRehabEditor key={++key} context={{
            planId: rehabOrigin.planId, revision: "a".repeat(32), editable: true, attachedIds: [],
            protocols: [{ id: rehabProtocol.id, name: window.rehabLongName }],
          }} /></main>);
        };
        window.showRehabWorkouts = (status = "available") => {
          if (status === "available") rehabSessionId = crypto.randomUUID();
          window.rehabSessionId = rehabSessionId;
          window.rehabCalls = []; window.rehabMode = "delay"; window.destinations = [];
          root.render(<main className={styles.page}><SwimRehabWorkouts key={++key} context={{
            workoutId: rehabOrigin.workoutId, revision: "a".repeat(32), canStart: true,
            entries: [{ protocolId: rehabProtocol.id, name: window.rehabLongName, status,
              sessionId: ["started", "completed", "deleted"].includes(status) ? rehabSessionId : null }],
          }} /></main>);
        };
        function RehabLoggingFixture() {
          const [sets, setSets] = useState([]);
          const unexpected = async () => { throw new Error("Unexpected rehab mutation"); };
          const save = async form => {
            window.rehabLogs.push(Object.fromEntries(form.entries()));
            const id = crypto.randomUUID();
            const log = optimisticLogFromFormData(form, String(form.get("clientLogId")));
            setSets(previous => [...previous, ...mergeOptimisticSets([], [{ ...log, serverId: id }])]);
            return { ok: true, set: { id } };
          };
          window.logFullStrength = save;
          return <main className={styles.page}><SessionLoggingStateProvider
            initialHasStrengthSets={sets.length > 0} initialLoggedStrengthClientIds={sets.map(set => set.client_log_id)}
            initialUnloggedStrengthCount={4 - sets.length}
            initialUnloggedRequiredIndices={[0,1,2,3].filter(index => !sets.some(set => set.prescription_item_index === index))}>
            <FullLoggingProbe />
            <SessionWorkArea sessionId={rehabSessionId} isComplete={false} performedAt="2026-09-14T12:00:00Z"
              sets={sets} tmBySlug={{}} oneRmBySlug={{}} lastSetHints={{}} priorBests={{}} prescription={rehabPrescription}
              loggedItemIndices={sets.map(set => set.prescription_item_index)}
              loggedSetIdByItemIndex={Object.fromEntries(sets.map(set => [set.prescription_item_index, set.id]))}
              swapAction={unexpected} fillFromPlan={unexpected} updateStrengthSet={unexpected}
              hapticsEnabled={false} timerSoundEnabled={false} restTimerEnabled={false} addStrengthSet={save} />
          </SessionLoggingStateProvider></main>;
        }
        window.showRehabLogger = () => {
          window.rehabLogs = [];
          root.render(<RehabLoggingFixture key={++key} />);
        };
        const ownedMovementId = "00000000-0000-4000-8000-000000000091";
        const replacementMovement = {
          id: "00000000-0000-4000-8000-000000000092", slug: "floor-press", displayName: "Floor Press",
        };
        function OwnedLoadFixture({ basis }) {
          const [sets, setSets] = useState([]);
          const [refreshed, setRefreshed] = useState(false);
          const [prescription, setPrescription] = useState({ items: [{
            movementId: ownedMovementId, movementSlug: "bench-press", movementName: "Bench Press",
            kind: "main", sets: 1, reps: 5, percentTm: 80, meta: { programLoadBasis: basis },
          }] });
          window.acknowledgeOwnedSwap = () => {
            setPrescription(window.ownedSavedPrescription);
            setRefreshed(true);
          };
          const unexpected = async () => { throw new Error("Unexpected owned-load mutation"); };
          const save = async form => {
            window.ownedLoadLogs.push(Object.fromEntries(form.entries()));
            const id = crypto.randomUUID();
            const log = optimisticLogFromFormData(form, String(form.get("clientLogId")));
            setSets(previous => [...previous, ...mergeOptimisticSets([], [{ ...log, serverId: id }])]);
            return { ok: true, set: { id } };
          };
          window.logFullStrength = save;
          window.swapOwnedMovement = async form => {
            window.ownedSwapCalls.push(Object.fromEntries(form.entries()));
            const context = getMovementSwapLoadContext(prescription, ownedMovementId, replacementMovement.id, true);
            const saved = swapMovementInPrescription(prescription, ownedMovementId, replacementMovement, undefined, undefined, {
              warmupScheme: { setCount: 0, percentLadder: [], repLadder: [] },
              replacementHasTrainingMax: context.replacementHasTrainingMax, preserveItemIndices: true,
            });
            window.ownedSavedPrescription = saved;
            return { ok: true, newMovement: replacementMovement, prescription: saved,
              loadContext: { oneRmKg: 100, tmKg: 90, isSystemLoad: false, bodyweightCapable: false },
              warning: context.requiresManualLoad ? SWAP_PROGRAM_LOAD_REQUIRED_WARNING : undefined };
          };
          return <main className={styles.page} data-testid="owned-load-fixture" data-refreshed={refreshed}><SessionLoggingStateProvider
            initialHasStrengthSets={sets.length > 0} initialLoggedStrengthClientIds={sets.map(set => set.client_log_id)}
            initialUnloggedStrengthCount={1 - sets.length} initialUnloggedRequiredIndices={sets.length ? [] : [0]}>
            <SessionWorkArea sessionId={window.ownedSessionId} plannedSessionId="owned-planned" isComplete={false}
              performedAt="2026-09-14T12:00:00Z" sets={sets} prescription={prescription}
              tmBySlug={{ "bench-press": 180, ...(refreshed ? { "floor-press": 90 } : {}) }}
              oneRmBySlug={{ "bench-press": 200, ...(refreshed ? { "floor-press": 100 } : {}) }}
              lastSetHints={{ [ownedMovementId]: { weightKg: 137.5, reps: 5 } }} priorBests={{}}
              loggedItemIndices={sets.map(set => set.prescription_item_index)}
              loggedSetIdByItemIndex={Object.fromEntries(sets.map(set => [set.prescription_item_index, set.id]))}
              swapAction={unexpected} fillFromPlan={unexpected} updateStrengthSet={unexpected}
              hapticsEnabled={false} timerSoundEnabled={false} restTimerEnabled={false} addStrengthSet={save} />
          </SessionLoggingStateProvider></main>;
        }
        window.showOwnedLoad = basis => {
          window.ownedSessionId = crypto.randomUUID();
          window.ownedLoadLogs = []; window.ownedSwapCalls = [];
          root.render(<OwnedLoadFixture key={++key} basis={basis} />);
        };
        const maxCandidates = [
          { id: "00000000-0000-4000-8000-000000000081", slug: "back-squat", display_name: "Back Squat" },
          { id: "00000000-0000-4000-8000-000000000082", slug: "front-squat", display_name: "Front Squat" },
          { id: "00000000-0000-4000-8000-000000000083", slug: "goblet-squat", display_name: "Goblet Squat" },
        ];
        function SharedMaxFixture() {
          const [rows, setRows] = useState(maxCandidates.slice(0, 2).map((movement, index) => ({
            id: "measurement-" + index, movementId: movement.id, movementName: movement.display_name,
            movementSlug: movement.slug, oneRmKg: index ? 80 : 100, tmPercentOverride: null, effectivePercent: 90,
            tmKg: index ? 72 : 90, source: "entered", updatedAt: "2026-09-14T12:00:00Z",
            systemLoad: false, derivedFromSessionId: null, derivedFromSetLogId: null, derivedFormula: null, derivedAt: null,
          })));
          window.sharedMaxRows = rows;
          const save = async form => {
            const input = Object.fromEntries(form.entries());
            window.sharedMaxCalls.push(input);
            if (window.sharedMaxMode === "error") return { ok: false, error: "Save refused" };
            const movement = maxCandidates.find(candidate => candidate.id === input.movementId);
            if (!movement) throw new Error("Unknown measurement");
            setRows(previous => {
              const existing = previous.find(row => row.movementId === movement.id);
              return existing
                ? previous.map(row => row === existing ? { ...row, oneRmKg: Number(input.oneRmKg) } : row)
                : [...previous, { ...previous[0], id: movement.id, movementId: movement.id,
                    movementName: movement.display_name, movementSlug: movement.slug, oneRmKg: Number(input.oneRmKg) }];
            });
            return { ok: true };
          };
          const unexpected = async () => { throw new Error("Unexpected measurement mutation"); };
          return <main className={styles.page}><TmSection units="metric"
            requiredGroups={[{ role: "squat", label: "Squat", candidates: maxCandidates, rows }]}
            otherRows={[]} pickerGroups={[]} upsertAction={save} deleteAction={unexpected} lockAction={unexpected} /></main>;
        }
        window.showSharedMaxes = () => {
          window.sharedMaxCalls = []; window.sharedMaxMode = "success";
          root.render(<SharedMaxFixture key={++key} />);
        };
        window.showOwnedLoadAdvice = editable => {
          window.loadAdviceCalls = [];
          const blockId = "00000000-0000-4000-8000-000000000084";
          root.render(<main className={styles.page}><ProgramRecommendationsBanner key={++key}
            programNames={{ [blockId]: "Strength A" }}
            recommendations={[{ id: "owned-load-advice", kind: "tm-bump", blockId,
              title: "Review working loads", detail: "Consider the load for your next cycle.",
              reviewHref: (editable ? "/app/program?edit=" : "/app/plan?block=") + blockId }]}
            dismissAction={async id => { window.loadAdviceCalls.push(id); return { ok: true }; }} /></main>);
        };
        window.showTmChoiceFailure = () => {
          window.tmChoiceCalls = 0;
          root.render(<main className={styles.page}><TmSuggestionBanner key={++key}
            suggestions={[{ id: "legacy-advice", movementName: "Back Squat", currentTmKg: 90, suggestedTmKg: 100,
              formula: null, setWeightKg: 100, setReps: 3, sessionPerformedAt: "2026-09-14T12:00:00Z" }]}
            acceptAction={async () => { window.tmChoiceCalls++; return { ok: false, error: "Open the workout's program to review its loads." }; }}
            dismissAction={async () => { throw new Error("Unexpected dismissal"); }} /></main>);
        };
        window.showHybridLoadSetup = () => {
          window.hybridLoadPreviews = []; window.hybridLoadSaves = [];
          window.continuationPreview = async input => {
            window.hybridLoadPreviews.push(input);
            return { ok: true, preview: { id: "e".repeat(64), revision: "a".repeat(32),
              dates: [{ date: input.startedOn, title: "Strength" }], overlaps: [], plannedRest: [], replaces: null } };
          };
          window.continuationSave = async input => {
            window.hybridLoadSaves.push(input);
            return { ok: true, blockId: "hybrid", programInstanceId: "hybrid-instance", skipped: 0 };
          };
          root.render(<ProgramPicker key={++key} anchoredKeys={["bench"]} initialProgramId="green-protocol"
            initialLoadoutValue="hybrid" programs={[{ ...greenProtocolEngine.meta, enabled: true, fixedSchedule: true,
              fields: greenProtocolEngine.describeSetup().fields }]} />);
        };
        function DeleteHistoryFixture() {
          const [deleted, setDeleted] = useState(false);
          window.deleteHistoryProgram = async form => {
            window.historyDeletionCalls.push(form.get("id"));
            await new Promise(resolve => window.resolveHistoryDeletion = resolve);
            setDeleted(true);
            return { ok: true, blockId: form.get("id") };
          };
          return deleted ? <p>Empty history</p> : <details data-testid="block-history-row"
            style={{ border: "1px solid var(--cp-border)", borderRadius: 12, overflow: "hidden" }}>
            <summary style={{ display: "grid", gap: 4, padding: "14px 18px", cursor: "pointer", listStyle: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                Hybrid <span style={{ marginLeft: "auto" }}><DeleteBlockMenu blockId="hybrid" archetypeName="Hybrid" /></span>
              </div>
              <div>2 d/wk · 4w · started 2026-09-28</div>
            </summary>
            <p>Workouts</p>
          </details>;
        }
        window.showDeleteHistory = () => {
          window.historyDeletionCalls = [];
          root.render(<DeleteHistoryFixture key={++key} />);
        };
        window.showProgramEnd = () => {
          root.render(<PlanProgramActions key={++key} blockId="legacy" canEdit
            editHref="/app/program?edit=legacy" startNewHref="/app/program"
            endAction={async () => { window.endedProgram = true; }} />);
        };
        function RehabLibraryFixture() {
          const [protocols, setProtocols] = useState([]);
          return <RehabProtocolsClient protocols={protocols}
            movements={[{ id: "00000000-0000-4000-8000-000000000090", name: "Bench press", pattern: "horizontal_push" }]}
            createAction={async payload => {
              window.rehabLibrarySaves.push(payload);
              await new Promise(resolve => window.resolveRehabLibrarySave = resolve);
              setProtocols([{ id: "saved-protocol", name: payload.name, ...payload.definition, revision: 1,
                updatedAt: "2026-09-28", usedBy: [] }]);
              return { ok: true, id: "saved-protocol", syncedPrograms: [] };
            }}
            updateAction={async () => { throw new Error("Unexpected protocol update"); }}
            duplicateAction={async () => { throw new Error("Unexpected protocol duplicate"); }}
            deleteAction={async () => { throw new Error("Unexpected protocol delete"); }} />;
        }
        window.showRehabLibrary = () => {
          window.rehabLibrarySaves = [];
          root.render(<RehabLibraryFixture key={++key} />);
        };
        function ContinuationFixture({ kind }) {
          const [open, setOpen] = useState(false);
          const [accepted, setAccepted] = useState(false);
          const recommendationId = "00000000-0000-4000-8000-000000000094";
          const recommendation = { recommendationId, programId: "green-protocol", kind,
            ...(kind === "next-block" ? { phaseId: "velocity" } : { recoveryWarning: "Recovery was recommended after the last phase." }) };
          window.continuationPreview = async input => {
            window.continuationPreviews.push(input);
            return { ok: true, preview: { id: "e".repeat(64), revision: "a".repeat(32),
              dates: [{ date: input.startedOn, title: "Next workout" }], overlaps: [], plannedRest: [], replaces: null } };
          };
          window.continuationSave = async input => {
            window.continuationSaves.push(input);
            if (window.continuationMode === "error") return { ok: false, error: "Could not save your program. Try again." };
            window.continuationStatus = "accepted"; setAccepted(true);
            return { ok: true, blockId: "next-program", programInstanceId: "next-instance", skipped: 0 };
          };
          return <main onClick={event => {
            const href = event.target.closest("a")?.getAttribute("href");
            if (href?.startsWith("/app/program?")) { event.preventDefault(); setOpen(true); }
            else if (href === "/app") { event.preventDefault(); setOpen(false); }
          }}>
            {open ? <ProgramPicker anchoredKeys={["squat"]} initialProgramId="green-protocol"
              initialLoadoutValue={recommendation.phaseId} recommendation={recommendation}
              programs={[{ id: "green-protocol", name: "Green Protocol", family: "tactical-barbell-green", summary: "",
                enabled: true, fixedSchedule: true, fields: [{ key: "phaseId", label: "Phase", type: "select",
                  defaultValue: "capacity", options: [{ value: "capacity", label: "Capacity" }, { value: "velocity", label: "Velocity" }] }] }]} />
              : <ProgramRecommendationsBanner recommendations={accepted ? [] : [{
                id: recommendationId, blockId: "previous-program", programName: "Completed Hybrid", programStatus: "completed",
                sourceProgramId: "green-protocol", kind, title: "Next phase", detail: "Review the next phase.",
                data: kind === "next-block" ? { programId: "green-protocol", nextPhaseId: "velocity", nextPhaseName: "Velocity" } : null,
              }]} dismissAction={async id => { window.continuationDismissals.push(id); return { ok: true }; }} />}
          </main>;
        }
        window.showContinuation = kind => {
          window.continuationPreviews = []; window.continuationSaves = []; window.continuationDismissals = [];
          window.continuationStatus = "pending"; window.continuationMode = "error";
          root.render(<ContinuationFixture key={++key} kind={kind} />);
        };
        function SeasonSetupFixture() {
          window.continuationPreview = async input => {
            window.seasonPreviews.push(input);
            if (input.seasonBlockId && window.seasonMode === "blocked") {
              return { ok: false, error: "End or complete Autumn strength before advancing its roadmap." };
            }
            return { ok: true, preview: { id: "e".repeat(64), revision: "a".repeat(32),
              dates: [{ date: input.startedOn, title: "Next workout" }], overlaps: [], plannedRest: [], replaces: null } };
          };
          window.continuationSave = async input => {
            window.seasonSaves.push(input);
            if (window.seasonMode === "stale") return { ok: false, error: "The roadmap changed. Review your setup again." };
            window.seasonSaved = true;
            return { ok: true, blockId: "season-program", programInstanceId: "season-instance", skipped: 0 };
          };
          return <ProgramPicker anchoredKeys={["squat"]} initialProgramId="green-protocol"
            initialLoadoutValue="velocity" seasonBlockId="00000000-0000-4000-8000-000000000095"
            programs={[{ id: "green-protocol", name: "Green Protocol", family: "tactical-barbell-green", summary: "",
              enabled: true, fixedSchedule: true, fields: [{ key: "phaseId", label: "Phase", type: "select",
                defaultValue: "capacity", options: [{ value: "capacity", label: "Capacity" }, { value: "velocity", label: "Velocity" }] }] }]} />;
        }
        window.showSeasonSetup = mode => {
          window.seasonPreviews = []; window.seasonSaves = []; window.seasonSaved = false; window.seasonMode = mode;
          root.render(<SeasonSetupFixture key={++key} />);
        };
        const setupSchedule = [
          { id: "one-off-run", source: "session", programId: null, date: "2026-09-14", title: "Run", state: "scheduled" },
          { id: "planned-rest", source: "primary", programId: "primary", date: "2026-09-17", title: "Rest", state: "rest" },
        ];
        window.previewSetup = async () => ({ ok: true, preview: {
          ...prepared.preview, id: "generated-preview", scheduleRevision: "a".repeat(32), overlaps: [setupSchedule[0]],
        } });
        window.saveSetup = async form => {
          window.setupCalls.push(Object.fromEntries(form.entries()));
          return window.setupMode === "error" ? { error: "Could not save." }
            : { ok: true, planId: "generated-plan", warning: "Refresh the plan." };
        };
        window.showSetup = () => {
          window.setupCalls = []; window.setupMode = "error";
          root.render(<main className={styles.page}><SetupForm key={++key} today="2026-09-14" schedule={setupSchedule} /></main>);
        };
        window.previewRestore = async input => {
          window.restorePreviews.push(input);
          return { revision: "a".repeat(32), requestId: "00000000-0000-4000-8000-000000000011",
            dates: ["2026-09-14"], overlaps: window.restoreOverlap ? [{
              id: "swim-restore", source: "swim", programId: "swim-plan", date: "2026-09-14",
              title: "Swimming", state: "scheduled",
            }] : [] };
        };
        window.commitRestore = async review => {
          window.restoreSaves.push(review);
          if (window.restoreMode === "error") throw new Error("Could not restore.");
        };
        window.restoreBlock = async (_id, review) => {
          try { await window.commitRestore(review); return { ok: true }; }
          catch (error) { return { ok: false, error: error.message }; }
        };
        window.showRestore = (kind, overlap = true) => {
          window.restorePreviews = []; window.restoreSaves = []; window.restoreOverlap = overlap; window.restoreMode = "error";
          root.render(<main className={styles.page} key={++key}>{kind === "block"
            ? <ul style={{ margin: 0, padding: 0 }}><TrashItemRow kind="block" id="00000000-0000-4000-8000-000000000012"
                title="Strength and running" subtitle="Started 2026-09-14" confirmToken="Strength and running" deletedAt="2026-09-14" /></ul>
            : <ScheduleRestoreButton kind="workout" id="00000000-0000-4000-8000-000000000013" label="Un-skip"
                testId="plan-drawer-unskip" onRestore={window.commitRestore} />}</main>);
        };
        const recoveryPreview = (percent = 60) => ({
          blockId: "00000000-0000-4000-8000-000000000014", afterWeek: 0, deloadWeekIndex: 1,
          percent, eventWarning: false, restOnly: false, outsideRecommended: false,
          sessions: [{ dayIndex: 1, slot: "single", title: "Recovery", sessionModality: "strength",
            prescription: { items: [{ kind: "main", movementId: "squat", movementName: "Squat", reps: 5, percentTm: percent }] } }],
          review: { id: String(percent).padStart(64, "0"), revision: "a".repeat(32),
            requestId: "00000000-0000-4000-8000-" + String(percent).padStart(12, "0"),
            dates: ["2026-09-28"], overlaps: [{ id: "recovery-swim", source: "swim", programId: "swim-plan",
              date: "2026-09-28", title: "Swimming", state: "scheduled" }] },
        });
        window.showRecovery = (recommendation = false) => {
          window.recoverySaves = []; window.recoveryPreviews = []; window.recoveryMode = "error"; window.recoveryPreviewMode = "success";
          root.render(<main className={styles.page}><DeloadWeekCard key={++key} preview={recoveryPreview()} autoOpen variant="quiet"
            previewAction={async percent => {
              window.recoveryPreviews.push(percent);
              if (percent === 61) await new Promise(resolve => window.resolveRecoveryPreview = resolve);
              if (window.recoveryPreviewMode === "error") throw new Error("Unavailable review");
              return recoveryPreview(percent);
            }}
            insertAction={async (...args) => {
              window.recoverySaves.push(args);
              return window.recoveryMode === "error" ? { ok: false, error: "Could not save." }
                : { ok: true, deloadWeekIndex: 1, sessions: 1 };
            }}
            resolveRecommendationId={recommendation ? "00000000-0000-4000-8000-000000000015" : undefined}
            resolveAction={async () => { throw new Error("Unavailable follow-up"); }} /></main>);
        };
        window.showEditor = () => root.render(<main className={styles.page}><section className={styles.section}>
          <h2>Swimming</h2><PoolEditor key={++key} busy={false} context={{
            planId: "00000000-0000-4000-8000-000000000001", revision: 1, defaultCourse: long,
            workout: { id: "00000000-0000-4000-8000-000000000002", revision: 1, course: long },
          }} onApply={preview => window.applied.push(preview)} />
        </section></main>);
        window.pendingCompletionEntries = listPending;
        window.retryCompletion = flushOutbox;
        window.showProgramProgress = () => {
          const blocks = [
            { blockId: "strength-progress", archetypeName: "Strength", logged: 1, scheduledToDate: 2, skipped: 0, weeklyTarget: 2, thisWeekCompleted: 1 },
            { blockId: "running-progress", archetypeName: "Running", logged: 2, scheduledToDate: 2, skipped: 0, weeklyTarget: 2, thisWeekCompleted: 2 },
            { blockId: "hybrid-progress", archetypeName: "Hybrid", logged: 0, scheduledToDate: 1, skipped: 1, weeklyTarget: 3, thisWeekCompleted: 0 },
          ].map(row => ({ ...row, weeks: 4, currentWeek: 2, daysPerWeek: row.weeklyTarget, totalScheduled: 8,
            planStrength: row.archetypeName !== "Running", planCardio: row.archetypeName !== "Strength", usesAdaptiveEngine: false,
            streak: { currentStreakWeeks: 0, weeklyTarget: row.weeklyTarget, thisWeekCompleted: row.thisWeekCompleted,
              thisWeekTarget: row.weeklyTarget, hasActiveBlock: true } }));
          root.render(<main key={++key} style={{ padding: 16, maxWidth: 960 }}>
            <section className="cp-card"><ProgramProgress blocks={blocks} hasSwimming /></section>
          </main>);
        };
        window.showCompletionRetry = (variant) => {
          const sessionId = "00000000-0000-4000-8000-000000000093";
          window.completionMode = "progress-error"; window.completionCalls = [];
          window.completeWorkout = async (...args) => {
            window.completionCalls.push(args);
            return window.completionMode === "progress-error"
              ? { error: "Workout saved. Program progress is waiting to sync.", errorCode: "transient", workoutSaved: true }
              : { ok: true };
          };
          window.logFullCardio = async form => window.completeWorkout(Object.fromEntries(form));
          root.render(<main className={styles.page} key={++key} style={{ paddingInline: 16 }}>
            {variant === "cardio"
              ? <CardioLogForm sessionId={sessionId} prescribedDurationMin={20} movementId={null} modality="run" units="metric"
                  action={window.logFullCardio} />
              : <FinishSessionBar sessionId={sessionId} variant={variant} disabled={false} />}
          </main>);
        };
      `,
      loader: "tsx", resolveDir: root,
    },
    bundle: true, write: false, outdir: "in-memory-swim-ui", format: "iife", platform: "browser",
    jsx: "automatic", logLevel: "warning",
    conditions: ["style"],
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": `${root}src` },
    plugins: [{
      name: "synthetic-actions",
      setup(build) {
        build.onResolve({ filter: /^(?:\.\/PlanRedesign|@\/components\/plan\/PlanRedesign)$/ }, args =>
          args.importer.replaceAll("\\", "/").endsWith("/components/plan/ThisWeekRail.tsx")
            ? { path: "home-drawer", namespace: "test" } : undefined);
        build.onResolve({ filter: /^@\/lib\/(?:sessions\/(?:actions|swap-actions|session-movement-actions|reorder-actions)|movements\/instructions)$/ },
          args => ({ path: args.path, namespace: "test" }));
        build.onResolve({ filter: /^@\/lib\/planner\/actions$/ }, args => ({ path: args.path, namespace: "test" }));
        build.onResolve({ filter: /^@\/lib\/platform\/actions$/ }, args => ({ path: args.path, namespace: "test" }));
        build.onResolve({ filter: /^@\/lib\/offline\/outbox$/ }, args => ({ path: args.path, namespace: "test" }));
        build.onResolve({ filter: /^(?:@\/lib\/swim\/(?:actions|import-actions|course-actions|import-match-actions|import-outcome-actions|rehab-actions)|@\/lib\/programs\/authored\/actions|@\/components\/trash\/DeleteSessionButton|next\/(?:navigation|link))$/ }, (args) => ({ path: args.path, namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents: args.path === "@/lib/sessions/actions"
            ? "const unexpected = () => { throw new Error('Unexpected session mutation'); }; export const deleteSet = form => window.deleteFullSet(form); export const permanentlyDeleteSession = unexpected, restoreSession = unexpected, addCardioBlock = unexpected; export const completeSessionResult = (...args) => { if (!window.completeWorkout) return unexpected(); return window.completeWorkout(...args); }; export const addStrengthSet = form => window.logFullStrength(form), logCardioSession = form => window.logFullCardio(form);"
            : args.path === "@/lib/sessions/session-movement-actions"
              ? "export const removeSessionMovementAction = () => { throw new Error('Unexpected removal'); };"
            : args.path === "@/lib/sessions/reorder-actions"
              ? "export const reorderSessionAccessories = () => { throw new Error('Unexpected reorder'); };"
            : args.path === "@/lib/planner/actions"
              ? "export const deleteBlock = form => window.deleteHistoryProgram(form); export const previewTrainingRestore = input => window.previewRestore(input); export const restoreBlock = (...args) => window.restoreBlock(...args); export const permanentlyDeleteBlock = () => { throw new Error('Unexpected deletion'); };"
            : args.path === "@/lib/platform/actions"
              ? "export const getProgramSegments = async () => ({ ok: true, segments: [] }); export const previewProgramInstance = input => window.continuationPreview(input); export const createProgramInstance = input => window.continuationSave(input);"
            : args.path === "@/lib/offline/outbox"
              ? `import { countForSession as count } from "./src/lib/offline/outbox";
                export * from "./src/lib/offline/outbox";
                export async function countForSession(id) {
                  const result = await count(id);
                  await window.beforeOutboxCount?.();
                  return result;
                }`
            : args.path === "@/lib/sessions/swap-actions"
              ? "export const swapActiveMovement = form => { if (!window.swapOwnedMovement) throw new Error('Unexpected swap'); return window.swapOwnedMovement(form); };"
            : args.path === "@/lib/movements/instructions"
              ? "export const getMovementInstructions = async () => null;"
            : args.path === "home-drawer"
            ? `import { createElement as h } from "react";
              export const sessionToOverdueCandidate = () => { throw new Error("Unexpected duplicate primary week"); };
              export function SessionDrawer({ session, onClose, moveAction, skipAction, unskipAction, updateNotesAction, startSessionAction }) {
                return h("div", { role: "dialog", "aria-label": session.title },
                  h("button", { type: "button", onClick: () => moveAction(new FormData()) }, "Move"),
                  h("button", { type: "button", onClick: () => skipAction(new FormData()) }, "Skip"),
                  h("button", { type: "button", onClick: () => unskipAction(new FormData()) }, "Undo skip"),
                  h("button", { type: "button", onClick: () => updateNotesAction(session.id, "updated") }, "Save notes"),
                  h("button", { type: "button", onClick: () => startSessionAction(new FormData()) }, "Start"),
                  h("button", { type: "button", onClick: onClose }, "Close"));
              }`
            : args.path === "next/navigation"
            ? "const router = { push(path) { window.destinations.push(path); }, refresh() {} }; export const useRouter = () => router; export const usePathname = () => '/app/plan/history';"
            : args.path === "next/link"
              ? `import { createElement } from "react"; export default function Link({ href, onClick, ...props }) {
                  return createElement("a", { ...props, href, onClick(event) {
                    onClick?.(event);
                    if (typeof href === "string" && href.startsWith("#") && !event.defaultPrevented) {
                      event.preventDefault(); history.pushState(null, "", href);
                    }
                  } });
                }`
            : args.path === "@/lib/swim/course-actions"
              ? "export const previewPrivateSwimCourse = form => window.previewCourse(form); export const importPrivateSwimCourse = (form, id) => window.saveCourse(form, id); export const previewPrivateSwimEdit = input => window.previewCourseEdit(input); export const savePrivateSwimEdit = input => window.saveCourseEdit(input);"
            : args.path === "@/lib/swim/import-actions"
              ? "export const connectSwimDashboard = () => window.connectDashboard(); export const disconnectSwimDashboard = id => window.disconnectDashboard(id);"
            : args.path === "@/lib/swim/import-match-actions"
              ? "export const findSwimMatchWorkouts = date => window.findWorkouts(date); export const saveSwimImportMatch = input => window.saveMatch(input);"
            : args.path === "@/lib/swim/import-outcome-actions"
              ? "export const saveSwimImportOutcome = input => window.saveOutcome(input);"
            : args.path === "@/lib/swim/rehab-actions"
              ? "export const saveSwimRehabAttachments = input => window.saveRehabAttachments(input); export const startSwimRehab = input => window.startRehab(input);"
            : args.path === "@/lib/programs/authored/actions"
              ? "export const previewAuthoredProgram = input => window.previewProgram(input); export const saveAuthoredProgram = (...args) => window.saveProgram(...args);"
            : args.path === "@/components/trash/DeleteSessionButton"
              ? "export const DeleteSessionButton = () => { throw new Error('Unexpected delete control'); };"
            : "export const previewSwimPoolEdit = input => window.previewPool(input); export const createSwimPlan = form => window.saveSetup(form); export const previewSwimPlan = form => window.previewSetup(form); const unexpected = () => { throw new Error('Unexpected action'); }; export const proposeSwimWeek = unexpected, proposeSwimBenchmark = unexpected, decideSwimProposal = unexpected, changeSwimPlanStatus = unexpected, previewSwimResume = unexpected, resumeSwimPlan = unexpected, decideSwimBenchmark = unexpected, applySwimWeekEdit = unexpected, applySwimDateEdit = unexpected, applySwimPoolEdit = unexpected, previewSwimWeekEdit = unexpected, previewSwimDateEdit = unexpected, skipSwimWorkout = unexpected, completeSwimWorkoutResult = unexpected;",
          loader: "js", resolveDir: root,
        }));
      },
    }],
  });
  const script = output.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = output.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  assert.ok(script && css);
  stages.push(stage);
  stage = "browser";
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  page.setDefaultTimeout(10_000);
  const failures = [];
  page.on("pageerror", () => failures.push("page-error"));
  // An intercepted HTTPS origin exercises native Web Crypto without network access.
  await page.route("**/*", (route) => route.request().url() === "https://swim-ui.test/"
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto("https://swim-ui.test/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });

  stage = "new-programme-default";
  await page.evaluate(() => window.showSetup());
  await page.getByRole("combobox", { name: "Pool length", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Pool length", exact: true }).inputValue(), "50m");
  stages.push(stage);

  for (const width of [375, 1280]) {
    stage = `authored-full-work-area-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showFullCircuit());
    await page.getByTestId("cardio-log-submit").click();
    const fullLogSet = page.getByTestId("movement-focus-log-button");
    for (let index = 0; index < 4; index++) {
      await fullLogSet.click();
      await expect.poll(() => page.evaluate(() => window.circuitWrites.length)).toBe(index + 1);
    }
    assert.deepEqual(await page.evaluate(() => window.circuitWrites), [1,3,2,4]);
    stages.push(stage);

    stage = `authored-full-refresh-during-save-${width}`;
    await page.evaluate(() => window.showFullCircuit(true));
    await page.getByTestId("cardio-log-submit").click();
    await fullLogSet.click();
    await expect.poll(() => page.evaluate(() => window.circuitWrites.length)).toBe(1);
    await page.evaluate(() => window.refreshFullCircuit());
    await page.evaluate(() => window.resolveFullStrength());
    for (let index = 1; index < 4; index++) {
      await fullLogSet.click();
      await expect.poll(() => page.evaluate(() => window.circuitWrites.length)).toBe(index + 1);
    }
    assert.deepEqual(await page.evaluate(() => window.circuitWrites), [1,3,2,4]);
    stages.push(stage);

    stage = `authored-full-stale-cardio-refresh-${width}`;
    await page.evaluate(() => window.showFullCircuit());
    await page.getByTestId("cardio-log-submit").click();
    await expect(fullLogSet).toBeEnabled();
    await page.evaluate(() => window.captureStaleCardioSnapshot());
    await fullLogSet.click();
    await expect(page.getByTestId("full-work-area")).toHaveAttribute("data-snapshot", "2");
    await page.evaluate(() => window.resolveFullCount());
    for (let index = 1; index < 4; index++) {
      await fullLogSet.click();
      await expect.poll(() => page.evaluate(() => window.circuitWrites.length)).toBe(index + 1);
    }
    const staleIndices = await page.evaluate(() => window.circuitWrites);
    assert.deepEqual(staleIndices, [1,3,2,4]);
    await expect(page.getByTestId("full-remaining")).toHaveText("0");
    stages.push(stage);

    stage = `authored-accepted-write-stale-snapshot-and-undo-${width}`;
    await page.evaluate(() => window.showFullCircuit());
    await page.getByTestId("cardio-log-submit").click();
    await expect(fullLogSet).toBeEnabled();
    await page.evaluate(() => window.captureStaleCardioSnapshot(false));
    await fullLogSet.click();
    const undo = page.getByTestId("session-dock-undo-button");
    await expect(undo).toBeVisible();
    await page.evaluate(() => window.refreshStaleFullCircuit());
    await expect(page.getByTestId("full-remaining")).toHaveText("3");
    await expect(page.getByTestId("full-remaining")).toHaveAttribute("data-planned", "3");
    await undo.click();
    await expect(page.getByTestId("full-remaining")).toHaveText("4");
    await expect(page.getByTestId("full-remaining")).toHaveAttribute("data-strength", "false");
    await page.evaluate(() => window.refreshFullCircuit());
    await expect(page.getByTestId("full-remaining")).toHaveText("4");
    stages.push(stage);

    stage = `authored-observed-write-and-deletion-${width}`;
    await page.evaluate(() => window.showFullCircuit());
    await page.getByTestId("cardio-log-submit").click();
    await fullLogSet.click();
    await expect(undo).toBeVisible();
    await page.evaluate(() => window.refreshFullCircuit());
    await expect(page.getByTestId("full-remaining")).toHaveText("3");
    await expect(page.getByTestId("full-remaining")).toHaveAttribute("data-planned", "3");
    await undo.click();
    await page.evaluate(() => window.refreshFullCircuit());
    await expect(page.getByTestId("full-remaining")).toHaveText("4");
    await expect(page.getByTestId("full-remaining")).toHaveAttribute("data-strength", "false");
    stages.push(stage);

    stage = `recovery-shared-review-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showRecovery());
    const addRecovery = page.getByTestId("deload-week-accept");
    await expect(addRecovery).toBeDisabled();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await expect(page.getByTestId("deload-week-cancel")).toBeEnabled();
    await page.getByTestId("deload-week-cancel").click();
    await expect(page.getByTestId("deload-week-modal")).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.recoverySaves.length), 0);
    await page.getByTestId("deload-week-review").click();
    const recoveryConsent = page.getByLabel("Keep both workouts on these dates", { exact: true });
    await recoveryConsent.check();
    await expect(addRecovery).toBeEnabled();
    const percent = page.getByRole("slider", { name: "Working weight", exact: true });
    await percent.focus(); await percent.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => window.recoveryPreviews)).toEqual([61]);
    await expect(recoveryConsent).not.toBeChecked();
    await expect(addRecovery).toBeDisabled();
    await expect(percent).toBeDisabled();
    await page.evaluate(() => window.resolveRecoveryPreview());
    await expect(percent).toBeEnabled();
    await expect(recoveryConsent).toBeEnabled();
    await expect(recoveryConsent).not.toBeChecked();
    await expect(addRecovery).toBeDisabled();
    await page.evaluate(() => { window.recoveryPreviewMode = "error"; });
    await percent.focus(); await percent.press("ArrowRight");
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(addRecovery).toBeDisabled();
    await expect(page.getByTestId("deload-week-cancel")).toBeEnabled();
    await page.evaluate(() => { window.recoveryPreviewMode = "success"; });
    await page.getByRole("button", { name: "Review again", exact: true }).click();
    await recoveryConsent.check();
    await addRecovery.click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(addRecovery).toBeEnabled();
    await page.evaluate(() => { window.recoveryMode = "success"; });
    await addRecovery.click();
    await expect(page.getByTestId("deload-week-done")).toBeVisible();
    const recoveryCalls = await page.evaluate(() => window.recoverySaves);
    assert.equal(recoveryCalls.length, 2);
    assert.deepEqual(recoveryCalls[0], recoveryCalls[1]);
    assert.equal(recoveryCalls[0][0], 62);
    assert.equal(recoveryCalls[0][3].previewId, "62".padStart(64, "0"));
    assert.equal(recoveryCalls[0][3].acceptOverlap, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    stages.push(stage);

    stage = `recovery-committed-followup-error-${width}`;
    await page.evaluate(() => { window.showRecovery(true); window.recoveryMode = "success"; });
    await recoveryConsent.check(); await addRecovery.click();
    await expect(page.getByTestId("deload-week-done")).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(addRecovery).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.recoverySaves.length), 1);
    stages.push(stage);

    for (const kind of ["workout", "block"]) {
      stage = `restore-${kind}-overlap-${width}`;
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(kind => window.showRestore(kind), kind);
      const restore = page.getByTestId(kind === "block" ? "recover-button" : "plan-drawer-unskip");
      await restore.click();
      await expect(restore).toBeDisabled();
      assert.equal(await page.evaluate(() => window.restoreSaves.length), 0);
      await page.getByLabel("Keep both workouts on these dates", { exact: true }).check();
      await restore.click();
      await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
      await expect(restore).toBeEnabled();
      await page.evaluate(() => { window.restoreMode = "success"; });
      await restore.click();
      await expect.poll(() => page.evaluate(() => window.restoreSaves.length)).toBe(2);
      const restored = await page.evaluate(() => ({ saves: window.restoreSaves, previews: window.restorePreviews }));
      assert.deepEqual(restored.saves[0], restored.saves[1]);
      assert.equal(restored.saves[0].acceptOverlap, true);
      assert.equal(restored.previews.length, 1);
      assert.equal(restored.previews[0].kind, kind);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      stages.push(stage);
    }
    stage = `restore-without-overlap-${width}`;
    await page.evaluate(() => window.showRestore("workout", false));
    await page.getByTestId("plan-drawer-unskip").click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    assert.equal(await page.getByRole("checkbox").count(), 0);
    await page.evaluate(() => { window.restoreMode = "success"; });
    await page.getByTestId("plan-drawer-unskip").click();
    await expect.poll(() => page.evaluate(() => window.restoreSaves.length)).toBe(2);
    const retry = await page.evaluate(() => window.restoreSaves);
    assert.deepEqual(retry[0], retry[1]);
    assert.equal(retry[0].acceptOverlap, false);
    stages.push(stage);

    stage = `generated-swim-shared-review-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showSetup());
    await expect(page.getByRole("button", { name: "Preview plan", exact: true })).toBeVisible();
    const monday = page.locator('input[name="weekdays"][value="1"]');
    const thursday = page.locator('input[name="weekdays"][value="4"]');
    await expect(monday).not.toBeChecked();
    await expect(thursday).not.toBeChecked();
    await monday.check();
    await expect(page.getByRole("button", { name: "Create swim plan", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Preview plan", exact: true }).click();
    const createSetup = page.getByRole("button", { name: "Create swim plan", exact: true });
    await expect(createSetup).toBeDisabled();
    await page.getByLabel("Keep both workouts on these dates", { exact: true }).check();
    await expect(createSetup).toBeEnabled();
    await page.getByLabel("Weeks", { exact: true }).fill("3");
    await expect(createSetup).toHaveCount(0);
    await page.getByRole("button", { name: "Preview plan", exact: true }).click();
    await expect(createSetup).toBeDisabled();
    await page.getByLabel("Keep both workouts on these dates", { exact: true }).check();
    await createSetup.click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(createSetup).toBeEnabled();
    await page.evaluate(() => { window.setupMode = "success"; });
    await createSetup.click();
    await expect(page.getByRole("link", { name: "Open swimming plan", exact: true })).toBeVisible();
    await expect(createSetup).toBeDisabled();
    const setupCalls = await page.evaluate(() => window.setupCalls);
    assert.equal(setupCalls.length, 2);
    assert.equal(setupCalls[0].requestId, setupCalls[1].requestId);
    assert.equal(setupCalls[0].previewId, "generated-preview");
    assert.equal(setupCalls[0].acceptOverlap, "on");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    stages.push(stage);

    stage = `authored-circuit-delayed-save-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showCircuit());
    const logCircuitSet = page.getByTestId("movement-focus-log-button");
    await expect(page.getByRole("heading", { name: "Station A", exact: true })).toBeVisible();
    for (let index = 0; index < 4; index++) {
      await logCircuitSet.click();
      await expect.poll(() => page.evaluate(() => window.circuitWrites.length)).toBe(index + 1);
      await expect(logCircuitSet).toBeDisabled();
      await page.evaluate(() => window.settleCircuitSave());
      if (index < 3) await expect(page.getByRole("heading", { name: index % 2 ? "Station A" : "Station B", exact: true })).toBeVisible();
    }
    assert.deepEqual(await page.evaluate(() => window.circuitWrites), [1, 3, 2, 4]);
    stages.push(stage);

    stage = `authored-circuit-rejected-save-${width}`;
    await page.evaluate(() => window.showCircuit());
    await expect(page.getByRole("heading", { name: "Station A", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Weight (kg)", exact: true }).fill("22");
    await logCircuitSet.click();
    await expect(logCircuitSet).toBeDisabled();
    assert.deepEqual(await page.evaluate(() => window.circuitWrites), [1]);
    await page.evaluate(() => window.settleCircuitSave({ error: "Synthetic rejected set" }));
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Station A", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Weight (kg)", exact: true })).toHaveValue("22");
    await logCircuitSet.click();
    await expect(logCircuitSet).toBeDisabled();
    assert.deepEqual(await page.evaluate(() => window.circuitWrites), [1, 1]);
    await page.evaluate(() => window.settleCircuitSave());
    await expect(page.getByRole("heading", { name: "Station B", exact: true })).toBeVisible();
    stages.push(stage);

    stage = `solo-optimistic-save-${width}`;
    await page.evaluate(() => window.showCircuit(true));
    await expect(page.getByRole("heading", { name: "Station A", exact: true })).toBeVisible();
    await logCircuitSet.click();
    await expect.poll(() => page.evaluate(() => window.circuitWrites.length)).toBe(1);
    await expect(logCircuitSet).toBeEnabled();
    await logCircuitSet.click();
    assert.deepEqual(await page.evaluate(() => window.circuitWrites), [1, 2]);
    await page.evaluate(() => { window.settleCircuitSave(); window.settleCircuitSave(); });
    stages.push(stage);

    stage = `shared-home-week-preview-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.homeCalls = []; window.showHomeWeek(); });
    await expect(page.getByRole("heading", { name: "This week", exact: true })).toHaveCount(1);
    await expect(page.getByTestId("plan-this-week")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Swim A Scheduled", exact: true }))
      .toHaveAttribute("href", "/app/swim/swim-home?from=today");
    const preview = page.getByRole("link", { name: "Strength A Preview", exact: true });
    await preview.click();
    const drawer = page.getByRole("dialog", { name: "Strength A", exact: true });
    await expect(drawer).toBeVisible();
    for (const name of ["Move", "Skip", "Undo skip", "Save notes", "Start"]) {
      await drawer.getByRole("button", { name, exact: true }).click();
    }
    assert.deepEqual(await page.evaluate(() => window.homeCalls), [
      "move", "skip", "unskip", ["notes", "primary-home", "updated"], "start",
    ]);
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.location.hash), "");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    await preview.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    stages.push(stage);

    stage = `authored-scoped-edit-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.programCalls = []; window.programMode = "success"; window.showProgramEdit(); });
    await page.getByLabel("Repeat sequence", { exact: true }).fill("3");
    await page.getByRole("combobox", { name: "Apply changes to", exact: true }).selectOption("future");
    await page.getByRole("button", { name: "Review changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
    const previewInput = await page.evaluate(() => window.programCalls[0].input);
    assert.equal(previewInput.scope, "future");
    assert.equal(previewInput.definition.workouts[0].parts[0].repeats, 3);
    await page.evaluate(() => {
      window.programMode = "stale";
      const announcer = document.createElement("next-route-announcer");
      announcer.attachShadow({ mode: "open" }).innerHTML = '<div role="alert" aria-live="assertive">Running fixture</div>';
      document.body.append(announcer);
    });
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(2);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await page.evaluate(() => document.querySelector("next-route-announcer").remove());
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Repeat sequence", { exact: true })).toHaveValue("3");
    assert.equal(await page.getByRole("combobox", { name: "Apply changes to", exact: true }).inputValue(), "future");
    assert.equal(await page.getByRole("link", { name: "Cancel", exact: true }).getAttribute("href"),
      "/app/plan?block=00000000-0000-4000-8000-000000000004");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    stages.push(stage);

    stage = `explicit-recording-match-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.matchCalls = []; window.findCalls = []; window.matchMode = "delay"; window.showMatcher(); });
    const date = page.getByLabel("Workout date", { exact: true });
    await expect(date).toHaveValue("");
    await date.fill("2026-09-15");
    await page.getByRole("button", { name: "Find workouts", exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect(date).toBeDisabled();
    assert.equal(await page.evaluate(() => window.findCalls.length), 1);
    await page.evaluate(() => { window.matchMode = "success"; window.resolveFind(); });
    const choices = page.getByRole("combobox", { name: "Workout", exact: true });
    await expect(choices).toHaveValue("");
    assert.equal(await page.getByRole("button", { name: "Match workout", exact: true }).count(), 0);
    await choices.selectOption("00000000-0000-4000-8000-000000000002");
    await date.fill("2026-09-16");
    assert.equal(await page.getByRole("button", { name: "Match workout", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Find workouts", exact: true }).click();
    await choices.selectOption("00000000-0000-4000-8000-000000000002");
    await page.evaluate(() => { window.matchMode = "error"; });
    await page.getByRole("button", { name: "Match workout", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(choices).toHaveValue("00000000-0000-4000-8000-000000000002");
    await page.evaluate(() => { window.matchMode = "success"; });
    await page.getByRole("button", { name: "Match workout", exact: true }).click();
    await expect(page.getByRole("button", { name: "Match workout", exact: true })).toBeEnabled();
    const calls = await page.evaluate(() => window.matchCalls);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].requestId, calls[1].requestId);
    assert.deepEqual(Object.keys(calls[0]).sort(), ["expectedMatchId", "importId", "requestId", "workoutId", "workoutRevision"]);
    assert.equal(calls[0].workoutRevision, 3);
    assert.equal(await page.getByRole("button", { name: /Start|Finish|Complete/ }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => { window.matchCalls = []; window.showMatcher(true, false); });
    await expect(page.getByRole("button", { name: "Remove match", exact: true })).toBeVisible();
    assert.equal(await page.getByRole("button", { name: "Find workouts", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Remove match", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove match", exact: true })).toBeEnabled();
    assert.equal(await page.evaluate(() => window.matchCalls[0].workoutId), null);
    assert.equal(await page.evaluate(() => window.matchCalls[0].workoutRevision), null);
    stages.push(stage);

    stage = `explicit-recording-outcome-${width}`;
    await page.evaluate(() => { window.outcomeCalls = []; window.outcomeMode = "delay"; window.showOutcome(); });
    const outcomeRegion = page.getByRole("region").filter({
      has: page.locator('h2 a[href="/app/swim/00000000-0000-4000-8000-000000000002?from=sessions"]'),
    });
    await expect(outcomeRegion).toHaveAccessibleName("steady swimming");
    const confirmOutcome = outcomeRegion.getByRole("button", { name: "Confirm outcome", exact: true });
    await expect(confirmOutcome).toBeDisabled();
    await outcomeRegion.getByRole("radio", { name: "Completed", exact: true }).check();
    await confirmOutcome.click();
    await expect(confirmOutcome).toBeDisabled();
    await expect(outcomeRegion.getByText("Completed", { exact: true })).toBeVisible();
    await expect(outcomeRegion.locator('p[aria-live="polite"]')).toHaveCount(0);
    await page.evaluate(() => window.resolveOutcome());
    await expect(outcomeRegion.locator('p[aria-live="polite"]')).toHaveText("Completed");
    await outcomeRegion.getByRole("button", { name: "Change outcome", exact: true }).click();
    await outcomeRegion.getByRole("radio", { name: "Stopped early", exact: true }).check();
    await confirmOutcome.click();
    await expect(confirmOutcome).toBeDisabled();
    await expect(outcomeRegion.getByText("Stopped early", { exact: true })).toBeVisible();
    await expect(outcomeRegion.locator('p[aria-live="polite"]')).toHaveText("Completed");
    await page.evaluate(() => window.resolveOutcome());
    await expect(outcomeRegion.locator('p[aria-live="polite"]')).toHaveText("Stopped early");
    const savedOutcomes = await page.evaluate(() => window.outcomeCalls);
    assert.equal(savedOutcomes.length, 2);
    assert.equal(savedOutcomes[0].outcome, "completed");
    assert.equal(savedOutcomes[1].outcome, "stopped_early");
    assert.equal(savedOutcomes[1].expectedOutcomeId, savedOutcomes[0].requestId);
    assert.equal(savedOutcomes[1].workoutId, "00000000-0000-4000-8000-000000000002");
    assert.equal(savedOutcomes[1].matchId, "00000000-0000-4000-8000-000000000003");
    assert.equal(savedOutcomes[1].workoutRevision, 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    stages.push(stage);

    stage = `recording-outcome-failure-replay-${width}`;
    await page.evaluate(() => { window.outcomeCalls = []; window.outcomeMode = "error"; window.showOutcome(); });
    await outcomeRegion.getByRole("radio", { name: "Stopped early", exact: true }).check();
    await confirmOutcome.click();
    await outcomeRegion.getByRole("alert").waitFor();
    await expect(outcomeRegion.getByRole("radio", { name: "Stopped early", exact: true })).toBeChecked();
    await page.evaluate(() => { window.outcomeMode = "success"; });
    await confirmOutcome.click();
    await expect(outcomeRegion.locator('p[aria-live="polite"]')).toHaveText("Stopped early");
    const replayedOutcomes = await page.evaluate(() => window.outcomeCalls);
    assert.equal(replayedOutcomes.length, 2);
    assert.equal(replayedOutcomes[0].requestId, replayedOutcomes[1].requestId);
    stages.push(stage);

    stage = `retained-recording-confirmation-removal-${width}`;
    await page.evaluate(() => { window.outcomeCalls = []; window.outcomeMode = "delay"; window.showOutcome(true); });
    await outcomeRegion.waitFor();
    await expect(outcomeRegion).toHaveAccessibleName("Week 1 A: steady swimming");
    await expect(page.getByRole("region", { name: "steady swimming", exact: true })).toHaveCount(0);
    await expect(outcomeRegion.getByRole("link", { name: "Week 1 A: steady swimming", exact: true }))
      .toHaveAttribute("href", "/app/swim/00000000-0000-4000-8000-000000000002?from=sessions");
    assert.equal(await outcomeRegion.getByRole("radio").count(), 0);
    assert.equal(await confirmOutcome.count(), 0);
    const removeOutcome = outcomeRegion.getByRole("button", { name: "Remove confirmation", exact: true });
    await removeOutcome.click();
    await expect(removeOutcome).toBeDisabled();
    await removeOutcome.evaluate((button) => button.click());
    const removals = await page.evaluate(() => window.outcomeCalls);
    assert.equal(removals.length, 1);
    assert.equal(removals[0].workoutId, "00000000-0000-4000-8000-000000000002");
    assert.equal(removals[0].expectedOutcomeId, "00000000-0000-4000-8000-000000000004");
    assert.equal(removals[0].outcome, null);
    assert.equal(removals[0].matchId, null);
    assert.equal(removals[0].workoutRevision, null);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => { window.resolveOutcome(); window.resolveOutcome = undefined; });
    await expect(outcomeRegion).toHaveCount(0);
    stages.push(stage);

    stage = `private-course-prehydration-file-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showServerCourse());
    const hydrationFile = page.locator("#server-course").getByLabel("Prepared plan file", { exact: true });
    const hydrationSource = await page.evaluate(() => JSON.stringify(window.courseSource));
    await hydrationFile.setInputFiles({ name: "synthetic.json", mimeType: "application/json", buffer: Buffer.from(hydrationSource) });
    assert.equal(await hydrationFile.evaluate((input) => input.files.length), 1);
    await page.evaluate(() => window.hydrateCourse());
    stage = `private-course-prehydration-recovery-${width}`;
    await expect(page.locator("#server-course").getByRole("heading", { name: "Synthetic private course", exact: true })).toBeVisible();
    await page.locator('#server-course input[name="weekdays"][value="3"]').check();
    await expect(page.locator('#server-course input[name="weekdays"][value="3"]')).toBeChecked();
    const replacementSource = JSON.parse(hydrationSource);
    replacementSource.title = "Replacement synthetic course";
    await hydrationFile.setInputFiles({ name: "replacement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(replacementSource)) });
    await expect(page.locator("#server-course").getByRole("heading", { name: replacementSource.title, exact: true })).toBeVisible();
    await hydrationFile.setInputFiles([]);
    await expect(page.locator('#server-course input[name="weekdays"]')).toHaveCount(0);
    await page.evaluate(() => window.removeServerCourse());
    stages.push(stage);

    stage = `private-course-review-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.courseCalls = []; window.courseMode = "delay"; window.showCourse(); });
    const file = page.getByLabel("Prepared plan file", { exact: true });
    const source = await page.evaluate(() => JSON.stringify(window.courseSource));
    await file.setInputFiles({ name: "synthetic.json", mimeType: "application/json", buffer: Buffer.from(source) });
    await page.getByRole("heading", { name: "Synthetic private course", exact: true }).waitFor();
    assert.equal(await page.locator('[name="timeBudgetMinutes"]').count(), 0);
    await page.getByRole("checkbox", { name: "Mon", exact: true }).check();
    await page.getByRole("checkbox", { name: "Thu", exact: true }).check();
    await page.getByRole("combobox", { name: "Experience", exact: true }).selectOption("regular");
    await page.getByRole("spinbutton", { name: "Comfortable non-stop lengths in the plan pool", exact: true }).fill("4");
    await page.getByRole("checkbox", { name: "Freestyle", exact: true }).check();
    await page.getByRole("button", { name: "Review plan", exact: true }).click();
    await page.waitForFunction(() => typeof window.resolveCourse === "function");
    assert.equal(await file.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.courseCalls), ["preview"]);
    await page.evaluate(() => { window.resolveCourse(); window.resolveCourse = undefined; window.courseMode = "success"; });
    const importPlan = page.getByRole("button", { name: "Import plan", exact: true });
    await importPlan.waitFor();
    const coursePreview = page.getByRole("region", { name: "Synthetic private course", exact: true });
    assert.equal(await coursePreview.getByText(/min limit|Up to .* min/).count(), 0);
    const previewTitles = await coursePreview.locator("details details summary strong").allTextContents();
    assert.ok(previewTitles[0].startsWith("Week 1 A"));
    assert.ok(previewTitles[1].startsWith("Week 1 B"));
    assert.equal(new Set(previewTitles).size, previewTitles.length);
    await coursePreview.locator("details details summary").first().click();
    const sourceDrill = await page.evaluate(() => window.sourceDrill);
    await coursePreview.getByText(sourceDrill, { exact: true }).first().waitFor();
    assert.deepEqual(await coursePreview.locator("li").first().locator("p").allTextContents(), [sourceDrill]);
    assert.equal(await page.getByRole("checkbox", { name: "Use the distances from the listed sets", exact: true }).isChecked(), false);
    await importPlan.click();
    assert.deepEqual(await page.evaluate(() => window.courseCalls), ["preview"]);
    await page.getByRole("checkbox", { name: "Use the distances from the listed sets", exact: true }).check();
    await page.getByRole("checkbox", { name: "Keep both workouts on these dates", exact: true }).check();
    await page.getByRole("checkbox", { name: "I have reviewed the workouts, dates and pools", exact: true }).check();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.evaluate(() => { window.courseMode = "error"; });
    await importPlan.click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("Start date", { exact: true }).inputValue(), "2026-09-14");
    await page.getByLabel("Start date", { exact: true }).fill("2026-09-15");
    assert.equal(await importPlan.count(), 0);
    await page.evaluate(() => { window.courseMode = "success"; });
    await page.getByRole("button", { name: "Review plan", exact: true }).click();
    await importPlan.waitFor();
    await page.getByRole("checkbox", { name: "Use the distances from the listed sets", exact: true }).check();
    await page.getByRole("checkbox", { name: "Keep both workouts on these dates", exact: true }).check();
    await page.getByRole("checkbox", { name: "I have reviewed the workouts, dates and pools", exact: true }).check();
    await importPlan.click();
    await page.getByRole("link", { name: "Open swimming plan", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.courseConfirmed), true);
    stages.push(stage);

    stage = `private-course-editor-${width}`;
    await page.evaluate(() => { window.courseCalls = []; window.showCourseEdit(); });
    await page.getByText("Edit workout", { exact: true }).click();
    const unspecifiedRest = page.getByRole("spinbutton", { name: "Rest (seconds)", exact: true }).first();
    assert.equal(await unspecifiedRest.inputValue(), "");
    await unspecifiedRest.fill("10");
    await unspecifiedRest.fill("");
    const main = page.getByRole("spinbutton", { name: "Repeats", exact: true }).nth(1);
    await main.fill("3");
    await page.getByRole("textbox", { name: "Reason for change", exact: true }).fill("Less pool time.");
    await page.getByRole("button", { name: "Review changes", exact: true }).click();
    const save = page.getByRole("button", { name: "Save changes", exact: true });
    await save.waitFor();
    assert.deepEqual(await page.evaluate(() => window.courseCalls), ["edit-preview"]);
    assert.equal(await page.evaluate(() => window.editedWorkout.sections[1].items[0].repeats), 3);
    assert.equal(await page.evaluate(() => window.editedWorkout.sections[0].items[0].restSeconds === undefined), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await main.fill("4");
    assert.equal(await save.count(), 0);
    await page.getByRole("button", { name: "Review changes", exact: true }).click();
    await save.click();
    await page.getByRole("button", { name: "Refresh workout", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.courseCalls), ["edit-preview", "edit-preview", "edit-save"]);
    stages.push(stage);
  }

  for (const width of [375, 1280]) {
    stage = `independent-programs-overview-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showProgramsOverview());
    const programs = page.getByRole("region", { name: "Programs", exact: true });
    await expect(programs.getByRole("heading", { level: 2 })).toHaveCount(3);
    const week = page.getByRole("region", { name: "This week", exact: true });
    await expect(week.locator('a[href^="/app/sessions/start/"],a[href^="/app/swim/"]')).toHaveCount(6);
    await expect(week.getByRole("link", { name: /^Edit / })).toHaveCount(4);
    await expect(programs.getByRole("link", { name: "Open program", exact: true }).first())
      .toHaveAttribute("href", "/app/plan?block=00000000-0000-4000-8000-000000000101");
    await expect(week.getByRole("link", { name: "Edit Easy run", exact: true })).toHaveAttribute("href",
      "/app/program/build?edit=00000000-0000-4000-8000-000000000102&workout=00000000-0000-4000-8000-000000000203");
    await page.evaluate(() => window.showProgramsOverview(undefined, true));
    await expect(programs.getByRole("heading", { level: 2 })).toHaveCount(4);
    await expect(week.locator('a[href^="/app/sessions/start/"],a[href^="/app/swim/"]')).toHaveCount(7);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => window.showProgramsOverview("running", true));
    await expect(programs.getByRole("heading", { level: 2 })).toHaveCount(1);
    await expect(programs.getByRole("link", { name: "Open program", exact: true }))
      .toHaveAttribute("href", "/app/plan?block=00000000-0000-4000-8000-000000000102");
    await expect(week.locator('a[href^="/app/sessions/start/"]')).toHaveCount(2);
    await expect(week.getByRole("link", { name: /^Run and stations/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New program", exact: true })).toHaveAttribute("href", "/app/program/build?activity=running");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => window.showOwnedRecommendation());
    await expect(page.getByText("Weekend hybrid", { exact: false })).toBeVisible();
    const recommendation = page.getByRole("link", { name: /^Take a recovery week/ });
    await expect(recommendation).toHaveAttribute("href", /[?&]block=00000000-0000-4000-8000-000000000103(?:&|$)/);
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(recommendation).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    stages.push(stage);
  }

  for (const width of [375, 1280]) {
    stage = `swim-rehab-library-attachments-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showRehabAttachments());
    const protocolChoice = page.getByRole("checkbox");
    await protocolChoice.check();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(protocolChoice).not.toBeChecked();
    assert.equal(await page.evaluate(() => window.rehabCalls.length), 0);
    await protocolChoice.check();
    const saveRehab = page.getByRole("button", { name: "Save changes", exact: true });
    await saveRehab.evaluate(button => { button.click(); button.click(); });
    await expect(protocolChoice).toBeDisabled();
    assert.equal(await page.evaluate(() => window.rehabCalls.length), 1);
    await page.evaluate(() => window.resolveRehab({ error: "Review your changed schedule.", errorCode: "validation" }));
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(protocolChoice).toBeChecked();
    await expect(protocolChoice).toBeEnabled();
    await page.evaluate(() => { window.rehabMode = "success"; });
    await saveRehab.click();
    await expect(saveRehab).toHaveCount(0);
    const attachmentCalls = await page.evaluate(() => window.rehabCalls);
    assert.equal(attachmentCalls.length, 2);
    assert.deepEqual(attachmentCalls[0], attachmentCalls[1]);
    assert.deepEqual(attachmentCalls[0].protocolIds, ["00000000-0000-4000-8000-000000000041"]);
    assert.equal(attachmentCalls[0].planId, "00000000-0000-4000-8000-000000000044");
    assert.equal(await page.getByRole("link", { name: "Rehab library", exact: true }).getAttribute("href"), "/app/settings/rehab-protocols");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    stages.push(stage);

    stage = `swim-rehab-start-and-logger-${width}`;
    await page.evaluate(() => window.showRehabWorkouts());
    const startRehab = page.getByRole("button", { name: /^Start Shoulder-/ });
    await startRehab.evaluate(button => { button.click(); button.click(); });
    await expect(startRehab).toBeDisabled();
    assert.equal(await page.evaluate(() => window.rehabCalls.length), 1);
    await page.evaluate(() => window.resolveRehab({ error: "Could not confirm the start.", errorCode: "transient" }));
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(startRehab).toBeEnabled();
    await page.evaluate(() => { window.rehabMode = "success"; });
    await startRehab.click();
    const rehabSessionId = await page.evaluate(() => window.rehabSessionId);
    await expect(page.getByRole("link", { name: "Continue rehab", exact: true })).toHaveAttribute("href", `/app/sessions/${rehabSessionId}`);
    assert.deepEqual(await page.evaluate(() => window.destinations), [`/app/sessions/${rehabSessionId}`]);
    const startCalls = await page.evaluate(() => window.rehabCalls);
    assert.equal(startCalls.length, 2);
    assert.deepEqual(startCalls[0], startCalls[1]);
    assert.equal(startCalls[0].workoutId, "00000000-0000-4000-8000-000000000045");
    assert.equal(startCalls[0].protocolId, "00000000-0000-4000-8000-000000000041");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => window.showRehabLogger());
    await expect(page.getByTestId("full-remaining")).toHaveText("4");
    for (let remaining = 3; remaining >= 0; remaining--) {
      await expect(page.getByTestId("movement-focus-log-button")).toContainText(/2\s*kg/);
      await page.getByTestId("movement-focus-log-button").click();
      await expect(page.getByTestId("full-remaining")).toHaveText(String(remaining));
    }
    await expect.poll(() => page.evaluate(() => window.rehabLogs.length)).toBe(4);
    const rehabLogs = await page.evaluate(() => window.rehabLogs);
    assert.deepEqual(rehabLogs.map(log => Number(log.prescriptionItemIndex)), [0, 2, 1, 3]);
    assert.deepEqual(rehabLogs.map(log => Number(log.reps)), [8, 10, 8, 10]);
    assert.deepEqual(rehabLogs.map(log => Number(log.weightKg)), [2, 2, 2, 2]);
    assert.deepEqual(rehabLogs.map(log => Number(log.targetWeightKg)), [2, 2, 2, 2]);
    assert.ok(rehabLogs.every(log => log.setKind === "tendon" && log.sessionId === rehabSessionId));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => window.showRehabWorkouts("completed"));
    await expect(page.getByRole("link", { name: "View rehab", exact: true })).toHaveAttribute("href", `/app/sessions/${rehabSessionId}`);
    await page.evaluate(() => window.showRehabWorkouts("deleted"));
    await expect(page.getByRole("link", { name: "Restore from Trash", exact: true })).toHaveAttribute("href", "/app/trash");
    await page.evaluate(() => window.showRehabWorkouts("removed"));
    await expect(page.getByRole("region", { name: "Rehab workouts", exact: true })).toBeVisible();
    assert.equal(await page.getByRole("button").count(), 0);
    assert.equal(await page.getByRole("link").count(), 0);
    stages.push(stage);
  }

  for (const width of [375, 1280]) {
    stage = `untimed-saved-course-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showCourseHub());
    await page.getByRole("heading", { name: "Swims", exact: true }).waitFor();
    const links = page.locator('a[href^="/app/swim/course-"]');
    assert.deepEqual(await links.locator("strong").allTextContents(), ["Week 1 A", "Week 1 B", "Week 2 A"]);
    assert.equal(await links.locator("small").filter({ hasText: /Week \d/ }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.evaluate(() => window.showWorkout());
    await page.getByRole("heading", { name: "Week 1 A", exact: true }).waitFor();
    assert.equal(await page.getByText(/min limit|Up to .* min/).count(), 0);
    await page.getByText(/Rest 20 sec/).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.evaluate(() => window.showWorkout(true));
    await page.getByText(/Up to 60 min/).waitFor();
    stages.push(stage);
  }

  for (const width of [375, 1280]) {
    stage = `review-and-confirm-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => { window.showEditor(); window.mode = "success"; window.applied = []; });
    await page.getByText("Change pool", { exact: true }).click();
    const select = page.getByRole("combobox", { name: "Pool length", exact: true });
    await select.selectOption("25m");
    await page.getByRole("button", { name: "Preview pool change", exact: true }).click();
    const save = page.getByRole("button", { name: "Save pool", exact: true });
    await save.waitFor();
    stage = `preview-read-only-${width}`;
    assert.equal(await page.evaluate(() => window.applied.length), 0);
    stage = `distance-visible-${width}`;
    assert.match(await page.locator("li").first().innerText(), /\b400 m(?:\s|$)/);
    stage = `lengths-visible-${width}`;
    assert.ok(await page.getByText("8 → 16 lengths", { exact: true }).isVisible());
    stage = `no-overflow-${width}`;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    stage = `explicit-save-${width}`;
    await save.click();
    assert.equal(await page.evaluate(() => window.applied.length), 1);
    stage = `preview-invalidation-${width}`;
    await select.selectOption("50m");
    assert.equal(await save.count(), 0);
    stages.push(stage);
  }
  stage = "obsolete-preview-and-error";
  await page.evaluate(() => { window.showEditor(); window.mode = "delay"; });
  await page.getByText("Change pool", { exact: true }).click();
  await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("25m");
  await page.getByRole("button", { name: "Preview pool change", exact: true }).click();
  await page.waitForFunction(() => typeof window.resolvePreview === "function");
  await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("50m");
  await page.evaluate(() => window.resolvePreview());
  await page.getByRole("button", { name: "Preview pool change", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Save pool", exact: true }).count(), 0);
  await page.evaluate(() => { window.mode = "error"; });
  await page.getByRole("button", { name: "Preview pool change", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "Save pool", exact: true }).count(), 0);
  assert.deepEqual(failures, []);
  stages.push(stage);

  for (const width of [375, 1280]) {
    stage = `connection-create-copy-disconnect-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      window.showConnection(true, false); window.importMode = "delay";
      window.clipboardMode = "success"; window.connectCalls = 0; window.disconnectCalls = [];
    });
    const create = page.getByRole("button", { name: "Create import key", exact: true });
    await create.click();
    await page.waitForFunction(() => typeof window.resolveConnect === "function");
    stage = `connection-pending-${width}`;
    assert.equal(await create.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.connectCalls), 1);
    await page.evaluate(() => { window.resolveConnect(); window.resolveConnect = undefined; window.importMode = "success"; });
    const key = page.getByRole("textbox", { name: "Import key", exact: true });
    await key.waitFor();
    stage = `connection-key-readonly-${width}`;
    assert.equal(await key.getAttribute("readonly"), "");
    stage = `connection-key-value-${width}`;
    assert.equal(await key.inputValue(), await page.evaluate(() => window.importKey));
    assert.equal(await create.count(), 0);
    stage = `connection-no-overflow-${width}`;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole("button", { name: "Copy key", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    stage = `connection-copied-key-${width}`;
    assert.equal(await page.evaluate(() => window.copiedKey), await key.inputValue());
    const disconnect = page.getByRole("button", { name: "Disconnect dashboard", exact: true });
    await page.evaluate(() => { window.importMode = "error"; });
    await disconnect.click();
    await page.getByRole("alert").waitFor();
    stage = `connection-failed-revocation-retains-key-${width}`;
    assert.equal(await key.inputValue(), await page.evaluate(() => window.importKey));
    stage = `connection-failed-revocation-allows-retry-${width}`;
    await expect(disconnect).toBeEnabled();
    await page.evaluate(() => { window.importMode = "success"; });
    await disconnect.click();
    await create.waitFor();
    stage = `connection-revocation-clears-key-${width}`;
    assert.equal(await key.count(), 0);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.disconnectCalls), [
      "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000003",
    ]);
    stages.push(stage);
  }

  stage = "connection-key-not-restored-and-disabled-revocation";
  await page.evaluate(() => window.showConnection(false, true));
  await page.getByRole("button", { name: "Disconnect dashboard", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Import key", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Create import key", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Disconnect dashboard", exact: true }).click();
  await page.getByText("No active key", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button").count(), 0);
  stages.push(stage);

  stage = "connection-failure-and-clipboard-recovery";
  await page.evaluate(() => { window.showConnection(true, false); window.importMode = "error"; });
  await page.getByRole("button", { name: "Create import key", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Import key", exact: true }).count(), 0);
  await page.evaluate(() => { window.importMode = "throw"; });
  await page.getByRole("button", { name: "Create import key", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Import key", exact: true }).count(), 0);
  await page.evaluate(() => { window.importMode = "success"; window.clipboardMode = "error"; });
  await page.getByRole("button", { name: "Create import key", exact: true }).click();
  const importKey = page.getByRole("textbox", { name: "Import key", exact: true });
  await importKey.waitFor();
  await page.getByRole("button", { name: "Copy key", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await importKey.focus();
  assert.deepEqual(await importKey.evaluate(input => [input.selectionStart, input.selectionEnd]), [0, 48]);
  assert.equal(await page.getByRole("button", { name: "Copied", exact: true }).count(), 0);
  await page.evaluate(() => { window.clipboardMode = "success"; });
  await page.getByRole("button", { name: "Copy key", exact: true }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.deepEqual(failures, []);
  stages.push(stage);
  await page.route("**/api/movements/swap-candidates**", route => route.fulfill({ json: { movements: [{
    id: "00000000-0000-4000-8000-000000000092", slug: "floor-press", display_name: "Floor Press",
    equipment: "barbell", recommended: true,
  }] } }));
  for (const width of [375, 1280]) {
    stage = `program-owned-load-and-swap-${width}`;
    await page.setViewportSize({ width, height: 900 });
    for (const [basis, weight, label] of [
      [{ version: 1, kind: "one-rm", percent: 100, roundingKg: 2.5 }, 160, "1RM"],
      [{ version: 1, kind: "working-max", kg: 75 }, 60, "TM"],
    ]) {
      await page.evaluate(basis => window.showOwnedLoad(basis), basis);
      await expect(page.getByRole("textbox", { name: "Weight (kg)", exact: true })).toHaveValue(String(weight));
      await expect(page.getByTestId("movement-focus-card").getByText(`80% ${label}`, { exact: true })).toBeVisible();
      await page.getByTestId("movement-focus-log-button").click();
      await expect.poll(() => page.evaluate(() => window.ownedLoadLogs.length)).toBe(1);
      const [log] = await page.evaluate(() => window.ownedLoadLogs);
      assert.equal(Number(log.weightKg), weight);
      assert.equal(Number(log.targetWeightKg), weight);
      assert.equal(log.movementId, "00000000-0000-4000-8000-000000000091");
    }
    for (const manual of [false, true]) {
      await page.evaluate(basis => window.showOwnedLoad(basis), manual
        ? { version: 1, kind: "working-max", kg: 100 }
        : { version: 1, kind: "one-rm", percent: 90, roundingKg: 2.5 });
      await page.getByTestId("focus-strip-swap").click();
      await page.getByRole("button", { name: /Floor Press/ }).click();
      if (manual) {
        await expect(page.getByTestId("swap-modal-warning")).toBeVisible();
        await page.getByTestId("swap-modal-close").click();
      }
      await expect(page.getByRole("heading", { name: "Floor Press", exact: true })).toBeVisible();
      const weight = page.getByRole("textbox", { name: "Weight (kg)", exact: true });
      await expect(weight).toHaveValue(manual ? "0" : "72.5");
      await expect(page.getByTestId("load-from-history")).toHaveCount(0);
      if (manual) {
        await expect(page.getByTestId("movement-focus-card").getByText(/80%/)).toHaveCount(0);
      }
      await weight.fill(manual ? "30" : "75");
      await page.evaluate(() => window.acknowledgeOwnedSwap());
      await expect(page.getByTestId("owned-load-fixture")).toHaveAttribute("data-refreshed", "true");
      await expect(weight).toHaveValue(manual ? "30" : "75");
      await page.getByTestId("movement-focus-log-button").click();
      await expect.poll(() => page.evaluate(() => window.ownedLoadLogs.length)).toBe(1);
      const [log] = await page.evaluate(() => window.ownedLoadLogs);
      assert.equal(log.movementId, "00000000-0000-4000-8000-000000000092");
      assert.equal(Number(log.weightKg), manual ? 30 : 75);
      assert.equal(log.targetWeightKg, manual ? undefined : "72.5");
      assert.equal(await page.evaluate(() => window.ownedSwapCalls.length), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    stages.push(stage);
  }
  await page.evaluate(() => { delete window.swapOwnedMovement; });
  await page.unroute("**/api/movements/swap-candidates**");
  assert.deepEqual(failures, []);
  for (const width of [375, 1280]) {
    stage = `shared-measurement-and-owned-advice-${width}`;
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.showSharedMaxes());
    const variant = page.getByRole("combobox", { name: "Squat variant", exact: true });
    const maxInput = page.getByRole("spinbutton", { name: "Squat 1RM", exact: true });
    await expect(maxInput).toHaveValue("100");
    await variant.selectOption({ label: "Front Squat" });
    await expect(maxInput).toHaveValue("80");
    await variant.selectOption({ label: "Goblet Squat" });
    await expect(maxInput).toHaveValue("");
    await variant.selectOption({ label: "Back Squat" });
    await expect(maxInput).toHaveValue("100");
    assert.deepEqual(await page.evaluate(() => window.sharedMaxCalls), []);
    await maxInput.fill("110");
    await maxInput.press("Tab");
    await expect.poll(() => page.evaluate(() => window.sharedMaxRows[0].oneRmKg)).toBe(110);
    await variant.selectOption({ label: "Front Squat" });
    await page.evaluate(() => { window.sharedMaxMode = "error"; });
    await maxInput.fill("85");
    await maxInput.press("Tab");
    await expect(page.getByRole("alert")).toBeVisible();
    await variant.selectOption({ label: "Back Squat" });
    await expect(maxInput).toHaveValue("110");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await variant.selectOption({ label: "Front Squat" });
    await expect(maxInput).toHaveValue("85");
    await expect(page.getByRole("alert")).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.sharedMaxRows.map(row => row.oneRmKg)), [110, 80]);
    await page.evaluate(() => { window.sharedMaxMode = "success"; });
    await maxInput.focus();
    await maxInput.press("Tab");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.sharedMaxRows[1].oneRmKg)).toBe(85);
    await variant.selectOption({ label: "Goblet Squat" });
    await maxInput.fill("70");
    await maxInput.press("Tab");
    await expect.poll(() => page.evaluate(() => window.sharedMaxRows.map(row => row.oneRmKg))).toEqual([110, 85, 70]);
    assert.equal(await page.evaluate(() => window.sharedMaxCalls.length), 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const editable of [true, false]) {
      await page.evaluate(editable => window.showOwnedLoadAdvice(editable), editable);
      await expect(page.getByText(/Strength A/)).toBeVisible();
      const review = page.getByRole("link", { name: editable ? "Review loads" : "Open program", exact: true });
      await expect(review).toHaveAttribute("href", `${editable ? "/app/program?edit=" : "/app/plan?block="}00000000-0000-4000-8000-000000000084`);
      await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
      assert.deepEqual(await page.evaluate(() => window.loadAdviceCalls), []);
    }
    await page.evaluate(() => window.showTmChoiceFailure());
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("tm-suggestion-legacy-advice")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
    assert.equal(await page.evaluate(() => window.tmChoiceCalls), 1);
    await page.evaluate(() => window.showHybridLoadSetup());
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Training Max", exact: true }).click();
    await page.getByRole("button", { name: "85%", exact: true }).click();
    await page.getByRole("button", { name: "1RM", exact: true }).click();
    await expect(page.getByRole("button", { name: "85%", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Training Max", exact: true }).click();
    await page.getByRole("button", { name: "85%", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await page.getByRole("button", { name: "Save program", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.hybridLoadSaves.length)).toBe(1);
    const savedHybrid = await page.evaluate(() => window.hybridLoadSaves[0]);
    assert.equal(savedHybrid.setupValues.useTrainingMax, true);
    assert.equal(savedHybrid.setupValues.tmPercent, .85);
    assert.equal(savedHybrid.editBlockId, undefined);
    await page.evaluate(() => window.showDeleteHistory());
    const historyRow = page.getByTestId("block-history-row");
    await historyRow.getByTestId("block-actions-trigger").click();
    await historyRow.getByTestId("delete-block-menu-item").click();
    await expect(historyRow.getByTestId("delete-block-menu-item")).toBeDisabled();
    assert.deepEqual(await page.evaluate(() => window.historyDeletionCalls), ["hybrid"]);
    await page.evaluate(() => window.resolveHistoryDeletion());
    await expect(historyRow).toHaveCount(0);
    await page.evaluate(() => window.showProgramEnd());
    await page.getByTestId("program-actions-more").click();
    await page.getByTestId("program-actions-end").click();
    await expect(page.getByTestId("end-block-confirm")).toBeVisible();
    await page.evaluate(() => window.showRehabLibrary());
    await page.getByRole("button", { name: "Create a protocol", exact: true }).click();
    await page.getByTestId("rehab-protocol-name").fill("Shared rehab");
    await page.getByTestId("rehab-protocol-search").fill("Bench");
    await page.getByTestId("rehab-protocol-picker").getByRole("button")
      .filter({ has: page.getByText("Bench press", { exact: true }) }).click();
    await page.getByLabel("Sets", { exact: true }).fill("1");
    await page.getByLabel("Reps", { exact: true }).fill("5");
    await page.getByLabel("Load kg", { exact: true }).fill("20");
    await page.getByTestId("rehab-protocol-save").click();
    await expect(page.getByTestId("rehab-protocol-save")).toBeDisabled();
    assert.deepEqual(await page.evaluate(() => window.rehabLibrarySaves), [{
      name: "Shared rehab", definition: { items: [{
        movementId: "00000000-0000-4000-8000-000000000090", movementName: "Bench press",
        sets: 1, reps: 5, holdSeconds: undefined, side: "both", targetWeightKg: 20,
      }], links: [] },
    }]);
    await page.evaluate(() => window.resolveRehabLibrarySave());
    await expect(page.getByTestId("rehab-protocol-new")).toBeVisible();
    stages.push(stage);
  }
  assert.deepEqual(failures, []);
  for (const width of [375, 1280]) {
    stage = `program-completion-retry-${width}`;
    await page.setViewportSize({ width, height: 900 });
    for (const variant of ["bottom", "banner", "menu", "cardio"]) {
      assert.deepEqual(await page.evaluate(() => window.pendingCompletionEntries()), []);
      await page.evaluate(variant => window.showCompletionRetry(variant), variant);
      const form = page.locator("form");
      const submit = form.locator('button[type="submit"]');
      await expect(submit).toBeVisible();
      await submit.click();
      const notice = page.getByTestId(variant === "cardio" ? "cardio-saved-offline" : "finish-saved-offline");
      await expect(notice).toContainText(/workout saved/i);
      await expect(notice).not.toContainText(/saved offline|saved on this device/i);
      const pending = await page.evaluate(() => window.pendingCompletionEntries());
      assert.equal(pending.length, 1);
      assert.equal(pending[0].sessionId, "00000000-0000-4000-8000-000000000093");
      assert.equal(pending[0].op, variant === "cardio" ? "cardio_session" : "complete");
      assert.equal(await page.evaluate(() => window.completionCalls.length), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.evaluate(() => { window.completionMode = "success"; });
      const flushed = await page.evaluate(() => window.retryCompletion());
      assert.equal(flushed.flushed, 1);
      assert.equal(flushed.remaining, 0);
      const calls = await page.evaluate(() => window.completionCalls);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], calls[0]);
    }
    stages.push(stage);
  }
  assert.deepEqual(failures, []);
  for (const width of [375, 1280]) {
    stage = `owned-program-progress-${width}`;
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.showProgramProgress());
    await expect(page.getByTestId("stats-card-active-block")).toHaveCount(3);
    for (const [id, completed, target] of [["strength-progress", 1, 2], ["running-progress", 2, 2], ["hybrid-progress", 0, 3]]) {
      const progress = page.locator(`[data-block-id="${id}"]`);
      await expect(progress).toContainText(`This week · ${completed} of ${target} done`);
      await expect(progress.getByTestId("stats-active-block-cta")).toHaveAttribute("href", `/app/stats/blocks/${id}`);
      const targetBox = await progress.getByTestId("stats-active-block-cta").boundingBox();
      assert.ok(targetBox && targetBox.height >= 44);
    }
    await expect(page.locator('[data-block-id="strength-progress"]').getByTestId("stats-active-block-completion")).toContainText("1 of 2");
    await expect(page.locator('[data-block-id="running-progress"]').getByTestId("stats-active-block-completion")).toContainText("2 of 2");
    await expect(page.getByRole("link", { name: /swimming progress/i })).toHaveAttribute("href", "/app/swim");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    stages.push(stage);
  }
  assert.deepEqual(failures, []);
  for (const width of [375, 1280]) {
    stage = `owned-recommendation-continuation-${width}`;
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.showContinuation("next-block"));
    const advance = page.getByRole("link", { name: /Set up Velocity/ });
    await expect(advance).toHaveAttribute("href", /recommendation=00000000-0000-4000-8000-000000000094/);
    await advance.click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review program dates" })).toBeVisible();
    assert.equal((await page.evaluate(() => window.continuationPreviews[0])).sourceRecommendationId, "00000000-0000-4000-8000-000000000094");
    await page.locator('a[href="/app"]').click();
    await expect(advance).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.continuationSaves), []);
    assert.deepEqual(await page.evaluate(() => window.continuationDismissals), []);
    await advance.click();
    await page.getByTestId("loadout-opt-capacity").click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review program dates" })).toBeVisible();
    assert.equal((await page.evaluate(() => window.continuationPreviews.at(-1))).sourceRecommendationId, undefined);
    await page.locator('a[href="/app"]').click();
    await advance.click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    const save = page.getByRole("button", { name: "Save program", exact: true });
    await save.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(save).toBeEnabled();
    assert.equal(await page.evaluate(() => window.continuationStatus), "pending");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => { window.continuationMode = "success"; });
    await save.click();
    await expect.poll(() => page.evaluate(() => window.continuationStatus)).toBe("accepted");
    const saves = await page.evaluate(() => window.continuationSaves);
    assert.equal(saves.length, 2);
    assert.deepEqual(saves[0], saves[1]);
    assert.equal(saves[1].sourceRecommendationId, "00000000-0000-4000-8000-000000000094");
    assert.deepEqual(await page.evaluate(() => window.continuationDismissals), []);
    await page.locator('a[href="/app"]').click();
    await expect(advance).toHaveCount(0);
    await page.evaluate(() => window.showContinuation("deload"));
    await page.getByRole("link", { name: "Plan a recovery week" }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const recovery = page.getByRole("checkbox", { name: "Start with a recovery week" });
    await expect(recovery).toBeChecked();
    const recoveryTarget = await recovery.locator("..").boundingBox();
    assert.ok(recoveryTarget && recoveryTarget.height >= 44);
    await recovery.uncheck();
    await expect(page.getByRole("status")).toBeVisible();
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review program dates" })).toBeVisible();
    const declined = await page.evaluate(() => window.continuationPreviews.at(-1));
    assert.equal(declined.sourceRecommendationId, "00000000-0000-4000-8000-000000000094");
    assert.equal(declined.startWithRecoveryWeek, undefined);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await recovery.check();
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review program dates" })).toBeVisible();
    assert.equal((await page.evaluate(() => window.continuationPreviews.at(-1))).startWithRecoveryWeek, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    stages.push(stage);
  }
  assert.deepEqual(failures, []);
  for (const width of [375, 1280]) {
    stage = `owned-season-continuation-${width}`;
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.showSeasonSetup("blocked"));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const linked = page.getByRole("checkbox", { name: "Link to season roadmap" });
    await expect(linked).toBeChecked();
    const linkTarget = await linked.locator("..").boundingBox();
    assert.ok(linkTarget && linkTarget.height >= 44);
    const start = page.locator('input[type="date"]').first();
    await start.fill("2027-02-08");
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Autumn strength");
    await expect(start).toHaveValue("2027-02-08");
    assert.deepEqual(await page.evaluate(() => window.seasonSaves), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await linked.uncheck();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review program dates" })).toBeVisible();
    const [blocked, unlinked] = await page.evaluate(() => window.seasonPreviews);
    assert.equal(blocked.seasonBlockId, "00000000-0000-4000-8000-000000000095");
    const { seasonBlockId: omitted, ...retained } = blocked;
    assert.ok(omitted);
    assert.deepEqual(unlinked, retained);
    await page.getByRole("button", { name: "Save program", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.seasonSaved)).toBe(true);
    const separate = await page.evaluate(() => window.seasonSaves[0]);
    assert.equal(separate.seasonBlockId, undefined);
    assert.equal(separate.startedOn, "2027-02-08");
    assert.equal(separate.setupValues.phaseId, "velocity");

    await page.evaluate(() => window.showSeasonSetup("ready"));
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await start.fill("2027-02-08");
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review program dates" })).toBeVisible();
    await page.evaluate(() => { window.seasonMode = "stale"; });
    await page.getByRole("button", { name: "Save program", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(start).toHaveValue("2027-02-08");
    await linked.uncheck();
    await page.getByRole("button", { name: "Review dates", exact: true }).click();
    await expect(page.getByRole("region", { name: "Review program dates" })).toBeVisible();
    await page.evaluate(() => { window.seasonMode = "ready"; });
    await page.getByRole("button", { name: "Save program", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.seasonSaved)).toBe(true);
    const saves = await page.evaluate(() => window.seasonSaves);
    assert.equal(saves.length, 2);
    assert.equal(saves[0].seasonBlockId, "00000000-0000-4000-8000-000000000095");
    assert.equal(saves[1].seasonBlockId, undefined);
    assert.notEqual(saves[0].review.requestId, saves[1].review.requestId);
    assert.equal(saves[1].startedOn, saves[0].startedOn);
    assert.deepEqual(saves[1].setupValues, saves[0].setupValues);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    stages.push(stage);
  }
  assert.deepEqual(failures, []);
  status = "passed";
} catch (error) {
  code = error?.code === "ERR_ASSERTION" ? "assertion"
    : /Executable doesn't exist/.test(error?.message ?? "") ? "missing-browser"
      : error?.name === "TimeoutError" ? "timeout" : "unexpected";
} finally {
  if (browser) {
    try { await browser.close(); }
    catch { if (status !== "failed") { stage = "browser-cleanup"; code = "cleanup"; } status = "failed"; }
  }
}
console.log(JSON.stringify({ scope: "swim-pool-ui-synthetic", status, stages, ...(status === "failed" ? { stage, code } : {}) }));
if (status !== "passed" && process.env.GITHUB_ACTIONS === "true") console.log(`::error title=Swimming pool controls::${stage} [${code}]`);
if (status !== "passed") process.exitCode = 1;
