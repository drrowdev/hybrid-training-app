const marker = "SWIM_CONDITIONING_REQUEST ";
const publicCode = /^(?:[0-9][0-9A-Z][0-9A-Z]{3}|(?:P0|XX|HV|F0)[0-9A-Z]{3}|PGRST[0-9]{3})$/;
// Exact source-owned names only; never emit a captured database identifier.
const denialTargets = {
  table: ["profiles", "movements", "training_maxes", "training_blocks", "planned_sessions", "program_instances",
    "swim_plans", "swim_workouts", "swim_conditioning_saves", "swim_conditioning_bindings", "swim_import_outcomes"],
  function: ["uid", "swim_conditioning_replay", "deploy_program_with_swimming", "deploy_program_instance_atomically",
    "swim_create_plan", "swim_local_today", "swim_validate_plan", "swim_validate_plan_binding",
    "swim_validate_workout", "swim_validate_state_append", "set_updated_at"],
  schema: ["public", "auth", "pg_catalog"],
};
function authorizationReason(value) {
  if (value?.code !== "42501") return undefined;
  if (value.message === "CONDITIONING_UNAUTHORIZED") return "owner_check";
  for (const [kind, names] of Object.entries(denialTargets)) {
    for (const name of names) {
      if (value.message === `permission denied for ${kind} ${name}` ||
          value.message === `permission denied for ${kind} "${name}"`) return `${kind}:${name}`;
      if (kind === "table" && value.message === `new row violates row-level security policy for table "${name}"`) {
        return `rls:${name}`;
      }
    }
  }
  return "unknown";
}
const operations = new Map([
  ["/rest/v1/rpc/swim_conditioning_replay", "replay"],
  ["/rest/v1/rpc/deploy_program_with_swimming", "save"],
  ["/rest/v1/profiles", "context"], ["/rest/v1/training_maxes", "context"], ["/rest/v1/movements", "context"],
]);
async function observe(response, operation) {
  let code = "ok";
  let authorization;
  if (response.ok) void response.body?.cancel().catch(() => {});
  if (!response.ok) {
    code = "unreadable";
    const reader = response.body?.getReader();
    if (reader) {
      let timer;
      try {
        const chunks = []; let bytes = 0;
        await Promise.race([
          (async () => {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 16_384) throw new Error("diagnostic_bound");
              chunks.push(part.value);
            }
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            code = typeof value?.code === "string" && publicCode.test(value.code) ? value.code : "other";
            authorization = authorizationReason(value);
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("diagnostic_bound")), 1000); }),
        ]);
      } catch { code = "unreadable"; authorization = undefined; }
      finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
    }
  }
  console.log(marker + JSON.stringify({ operation, status: response.status, code,
    ...(authorization === undefined ? {} : { authorization }) }));
}
if (process.env.SWIM_ACCOUNT_FLOW_OBSERVE === "1") {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const operation = url.origin === process.env.NEXT_PUBLIC_SUPABASE_URL ? operations.get(url.pathname) : undefined;
    if (operation && (operation !== "context" || !response.ok)) void observe(response.clone(), operation);
    return response;
  };
}
