import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolvePrescribedSnapshot, type AuthoredCatalogMovement, type AuthoredProgramDefinition } from "@hta/domain";
import { MODULAR_LEGACY_FILE, modularLegacySchema, legacyGraphSnapshot, legacyRowsSchema as rowsSchema, legacyGraphColumns as columns,
  type ModularLegacyFixture } from "../e2e/fixtures/modular-legacy";
import { addDaysToYmd } from "../src/lib/dates";
import { authoredProgramInput } from "../e2e/fixtures/modular-programs";
import { acceptanceAssert as assert } from "./swim-acceptance-errors";
import { requireManualContext } from "./swim-acceptance-guards";

type Target = { url: string; anonKey: string; serviceRoleKey: string; projectRef: string };
export type LegacyUpgradeProof = {
  prepared: boolean; unchanged: boolean; beforeSha256: string | null; afterSha256: string | null;
  cleanup: "not-required" | "pending" | "verified";
};
export const createLegacyUpgradeProof = (): LegacyUpgradeProof => ({
  prepared: false, unchanged: false, beforeSha256: null, afterSha256: null, cleanup: "not-required",
});

export function legacyProgramInput(movement: AuthoredCatalogMovement, today: string) {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = [weekday, (weekday + 1) % 7];
  const startedOn = addDaysToYmd(today, -7);
  const definition: AuthoredProgramDefinition = {
    version: 1, activity: "strength", name: "Older strength program", weeks: 1,
    workouts: days.map((day) => ({
      id: randomUUID(), name: "Older strength workout", weekday: day,
      parts: [{ id: randomUUID(), kind: "movement", movement: {
        id: randomUUID(), movementId: movement.id, role: "main", sets: 1,
        dose: { kind: "reps", reps: 5 }, weightKg: 20, restSeconds: 0, notes: "",
      } }],
    })),
  };
  return authoredProgramInput(definition, startedOn, [movement]);
}

export function createModularLegacyPreparation(options: {
  target: Target; runDirectory: string; proof: LegacyUpgradeProof; secrets: Set<string>;
}) {
  const { target, runDirectory, proof, secrets } = options;
  const file = join(runDirectory, MODULAR_LEGACY_FILE);
  let admin: SupabaseClient | undefined;
  let actor: SupabaseClient | undefined;
  let userId: string | undefined;
  let sessionId: string | undefined;
  let fixture: ModularLegacyFixture | undefined;
  const guard = () => {
    const project = requireManualContext(process.env, process.env.GITHUB_SHA ?? "");
    assert(process.platform === "linux" && process.env.SXC_ACCEPTANCE_PROFILE === "modular" &&
      target.url === "http://127.0.0.1:54321" && target.projectRef === "local",
    "Disposable legacy preparation required");
    assert(runDirectory === join(realpathSync(process.env.RUNNER_TEMP!), `swim-acceptance-${project}`),
      "Owned legacy directory required");
    const stat = lstatSync(runDirectory);
    assert(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(runDirectory) === runDirectory &&
      stat.uid === process.getuid?.() && (stat.mode & 0o7777) === 0o700, "Private legacy directory required");
  };
  const client = (key: string) => createClient(target.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error",
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) }) },
  });
  return {
    async prepare() {
      guard();
      assert(!userId && !proof.prepared && !existsSync(file), "Legacy preparation already attempted");
      admin = client(target.serviceRoleKey);
      const email = `e2e+${randomUUID()}@hta-e2e.com`, password = randomUUID();
      secrets.add(email); secrets.add(password);
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert(created.error === null && created.data.user, "Legacy synthetic account allocation failed");
      userId = created.data.user.id;
      proof.cleanup = "pending";
      actor = client(target.anonKey);
      const signed = await actor.auth.signInWithPassword({ email, password });
      assert(signed.error === null && signed.data.session, "Legacy owner authentication failed");
      secrets.add(signed.data.session.access_token); secrets.add(signed.data.session.refresh_token);
      const profile = await actor.from("profiles").update({ onboarded_at: new Date().toISOString(), timezone: "UTC" })
        .eq("id", userId).select("id").single();
      assert(profile.error === null && profile.data?.id === userId, "Legacy owned profile setup failed");
      const movement = await actor.from("movements").select("id,slug,display_name,pattern")
        .eq("slug", "bench-press-flat").is("user_id", null).single();
      assert(movement.error === null && movement.data, "Legacy library movement missing");
      const selected = z.object({ id: z.string().uuid(), slug: z.string(), display_name: z.string(), pattern: z.string() })
        .parse(movement.data);
      const today = new Date().toISOString().slice(0, 10);
      const input = legacyProgramInput({ ...selected, displayName: selected.display_name }, today);
      const deployed = await actor.rpc("deploy_program_instance_atomically", input);
      assert(deployed.error === null, "Historical owner deployment failed");
      const graph = z.array(z.object({ block_id: z.string().uuid(), program_instance_id: z.string().uuid() }))
        .length(1).parse(deployed.data)[0]!;
      const planned = await actor.from("planned_sessions").select("id").eq("user_id", userId)
        .eq("block_id", graph.block_id).order("id");
      assert(planned.error === null, "Legacy workouts missing");
      const plannedIds = rowsSchema.length(2).parse(planned.data).map((row) => row.id);
      const started = await actor.rpc("start_planned_session_atomically", { p_planned_id: plannedIds[0] });
      assert(started.error === null, "Historical owner start failed");
      sessionId = z.string().uuid().parse(started.data);
      const prescribed = resolvePrescribedSnapshot(input.p_planned_sessions[0]!.prescription.items[0]);
      const logged = await actor.rpc("insert_set_log_with_bw_progress", { p_set_log: {
        session_id: sessionId, movement_id: selected.id, set_index: 1, set_kind: "main", weight_kg: 20, reps: 5,
        prescription_item_index: 0, client_log_id: randomUUID(), skipped: false,
        target_weight_kg: prescribed.targetWeightKg, target_reps: prescribed.targetReps, prescribed: prescribed.prescribed,
      } });
      assert(logged.error === null, "Historical owner logging failed");
      const completed = await actor.rpc("complete_training_session_with_transition", {
        p_session_id: sessionId, p_notes: null, p_completion_entry_id: randomUUID(),
      });
      assert(completed.error === null, "Historical owner completion failed");
      assert(z.array(z.object({ user_id: z.string().uuid(), transitioned: z.literal(true) }))
        .length(1).parse(completed.data)[0]!.user_id === userId, "Legacy completion owner mismatch");
      const before = await legacyGraphSnapshot(actor, userId);
      fixture = modularLegacySchema.parse({ version: 1, run: basename(runDirectory), email, password, userId,
        blockId: graph.block_id, instanceId: graph.program_instance_id, plannedIds,
        sessionId, setId: before.rows.set_logs![0]!.id, beforeSha256: before.sha256 });
      writeFileSync(file, JSON.stringify(fixture), { flag: "wx", mode: 0o600 });
      proof.beforeSha256 = before.sha256;
      proof.prepared = true;
    },
    async verifyUpgrade() {
      guard();
      assert(actor && userId && fixture && proof.prepared && !proof.unchanged, "Prepared legacy owner required");
      proof.afterSha256 = (await legacyGraphSnapshot(actor, userId)).sha256;
      assert(proof.afterSha256 === proof.beforeSha256, "Legacy graph changed during ownership upgrade");
      proof.unchanged = true;
    },
    async cleanup() {
      if (!userId) return;
      guard();
      assert(admin && proof.cleanup === "pending", "Legacy cleanup already attempted");
      const removed = await admin.auth.admin.deleteUser(userId);
      assert(removed.error === null, "Legacy synthetic account cleanup failed");
      const remaining = await admin.auth.admin.getUserById(userId);
      assert(remaining.data.user === null && remaining.error?.status === 404, "Legacy synthetic account remains");
      if (actor) {
        for (const table of Object.keys(columns)) {
          const rows = await actor.from(table).select("id").eq("user_id", userId);
          assert(rows.error === null && rows.data?.length === 0, "Legacy owned graph remains after account cleanup");
        }
        if (sessionId) {
          const sets = await actor.from("set_logs").select("id").eq("session_id", sessionId);
          assert(sets.error === null && sets.data?.length === 0, "Legacy owned results remain after account cleanup");
        }
      }
      if (existsSync(file)) unlinkSync(file);
      proof.cleanup = "verified";
    },
  };
}
