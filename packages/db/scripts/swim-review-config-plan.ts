import { z } from "zod";
import { APPLICATION_SHA, validateDatabaseUrl } from "./prepare-swim-review";

export const REVIEW = {
  branch: "copilot/new-acceptance-cases",
  repository: "drrowdev/hybrid-training-app",
  projectId: "prj_l1PzxaQIdTYgRSW0mlch95oxFiXo",
  projectName: "hybrid-training-app-web",
  teamId: "team_iA9mJFP3tnxhxrO7v7DM192Q",
  supabaseId: "whwilnhqfiaquwxgkxwt",
  supabaseName: "sxc-swim-test-stockholm",
  organizationId: "ttxxqipkcgtirtmhhlnb",
  region: "eu-north-1",
  proposedAlias: "hybrid-training-app-swim-review-drrowdevs-projects.vercel.app",
  origin: "https://hybrid-training-app-swim-review-drrowdevs-projects.vercel.app",
  supabaseUrl: "https://whwilnhqfiaquwxgkxwt.supabase.co",
} as const;

const disabledKeys = [
  "STRAVA_REDIRECT_URI", "ADMIN_EMAILS", "STRAVA_WEBHOOK_SUBSCRIPTION_ID",
  "STRAVA_CLIENT_SECRET", "STRAVA_CLIENT_ID", "STRAVA_WEBHOOK_CALLBACK_URL",
  "STRAVA_WEBHOOK_VERIFY_TOKEN", "MCP_TOKEN_SIGNING_KEY", "AI_KEY_ENCRYPTION_KEY",
] as const;
export const INHERITED_KEYS = [
  ...disabledKeys, "CRON_SECRET", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL",
] as const;
export const OVERRIDE_KEYS = [
  ...INHERITED_KEYS, "POOL_SWIMMING_ENABLED", "ENABLE_E2E_FIXTURES", "NEXT_PUBLIC_BUILD_SHA",
] as const;
type OverrideKey = typeof OVERRIDE_KEYS[number];

export enum PlanFailure {
  Context = "context_invalid",
  Project = "project_identity_invalid",
  Supabase = "supabase_identity_invalid",
  Metadata = "metadata_invalid",
  Incomplete = "metadata_incomplete",
  Duplicate = "metadata_duplicate",
  ExistingOverride = "feature_override_exists",
  UnknownPreviewKey = "preview_key_unreviewed",
  Credentials = "credentials_invalid",
  Database = "database_target_invalid",
  Auth = "prior_auth_invalid",
  Input = "input_invalid",
}

const contextSchema = z.object({
  actions: z.literal(true), eventName: z.literal("workflow_dispatch"),
  repository: z.literal(REVIEW.repository), refType: z.literal("branch"),
  ref: z.literal(`refs/heads/${REVIEW.branch}`),
  configure: z.literal(true), inspect: z.literal(false), prepare: z.literal(false),
  swimAcceptance: z.literal(false), migrateProduction: z.literal(false),
  allowUndeployed: z.literal(false),
  expectedSha: z.string().regex(/^[0-9a-f]{40}$/), githubSha: z.string(),
}).strict().refine((c) => c.expectedSha === c.githubSha && c.expectedSha !== APPLICATION_SHA);
export type ManualContext = z.infer<typeof contextSchema>;

const projectSchema = z.object({
  id: z.literal(REVIEW.projectId), accountId: z.literal(REVIEW.teamId),
  name: z.literal(REVIEW.projectName), rootDirectory: z.literal("apps/web"),
  framework: z.literal("nextjs"),
  link: z.object({
    type: z.literal("github"), org: z.literal("drrowdev"),
    repo: z.literal("hybrid-training-app"), productionBranch: z.literal("main"),
  }).strict(),
}).strict();
const supabaseSchema = z.object({
  id: z.literal(REVIEW.supabaseId), name: z.literal(REVIEW.supabaseName),
  organization_id: z.literal(REVIEW.organizationId), region: z.literal(REVIEW.region),
}).strict();

const targetSchema = z.enum(["preview", "production", "development"]);
const marker = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metadataSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
  type: z.enum(["encrypted", "plain", "secret", "sensitive", "system"]),
  target: z.array(targetSchema).min(1).max(3).refine((t) => new Set(t).size === t.length),
  gitBranch: z.string().min(1).max(255).regex(/^[A-Za-z0-9_./-]+$/).nullable(),
  id: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
  createdAt: marker, updatedAt: marker,
}).strict().refine((e) => e.updatedAt >= e.createdAt &&
  (e.gitBranch === null || (e.target.length === 1 && e.target[0] === "preview")));
export type EnvironmentMetadata = z.infer<typeof metadataSchema>;
// The future adapter must supply explicit, complete metadata-only snapshots, never raw env values.
const listSchema = z.object({
  entries: z.array(metadataSchema).max(1000),
  complete: z.literal(true), pagination: z.null(),
}).strict();

const authSchema = z.object({
  site_url: z.string().max(2048), uri_allow_list: z.string().max(4096),
  disable_signup: z.boolean(),
}).strict();
type AuthFields = z.infer<typeof authSchema>;
const localOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
function allowedAuthUrl(value: string, callback: boolean) {
  return value === "" || [...localOrigins, REVIEW.origin].some((origin) =>
    value === origin || (callback && value === `${origin}/auth/callback`));
}

const credentialsSchema = z.object({
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{20,256}$/),
  secretKey: z.string().regex(/^sb_secret_[A-Za-z0-9_-]{20,256}$/),
  databaseUrl: z.string().max(4096),
  testCronSecret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
}).strict().refine((c) => c.testCronSecret !== c.publishableKey &&
  c.testCronSecret !== c.secretKey);
export type TestCredentials = z.infer<typeof credentialsSchema>;
export type ConfigurationInput = {
  context: ManualContext;
  project: unknown;
  supabase: unknown;
  projectEnvironment: unknown;
  sharedEnvironment: unknown;
  priorAuth: unknown;
  credentials: TestCredentials;
};
type Override = {
  key: OverrideKey; value: string; type: "encrypted";
  target: ["preview"]; gitBranch: typeof REVIEW.branch;
};
export type ConfigurationPlan = {
  proposedAlias: { hostname: typeof REVIEW.proposedAlias; availability: "unverified" };
  environment: {
    operation: "create"; upsert: false; overrides: Override[];
    preserved: { project: EnvironmentMetadata[]; shared: EnvironmentMetadata[] };
  };
  auth: { previous: AuthFields; patch: AuthFields };
};
export type PlanResult =
  | { ok: true; plan: ConfigurationPlan }
  | { ok: false; code: PlanFailure };

function refuse(code: PlanFailure): never { throw code; }
function parse<T>(schema: z.ZodType<T>, input: unknown, code: PlanFailure): T {
  const result = schema.safeParse(input);
  if (!result.success) refuse(code);
  return result.data;
}
function reviewMetadata(input: unknown): EnvironmentMetadata[] {
  const list = parse(listSchema, input, PlanFailure.Metadata);
  const ids = new Set<string>();
  const scopes = new Set<string>();
  for (const entry of list.entries) {
    if (ids.has(entry.id)) refuse(PlanFailure.Duplicate);
    ids.add(entry.id);
    if (entry.gitBranch === REVIEW.branch) refuse(PlanFailure.ExistingOverride);
    for (const target of entry.target) {
      const scope = JSON.stringify([entry.key, entry.gitBranch, target]);
      if (scopes.has(scope)) refuse(PlanFailure.Duplicate);
      scopes.add(scope);
    }
    if (entry.gitBranch === null && entry.target.includes("preview") &&
      !(INHERITED_KEYS as readonly string[]).includes(entry.key)) {
      refuse(PlanFailure.UnknownPreviewKey);
    }
  }
  return list.entries;
}

// Supplied context is not proof of actual HEAD, a clean worktree, live refs, or deployed precedence.
// Values in this plan are for the future request transport only; never log/serialize the whole plan.
export function buildConfigurationPlan(input: ConfigurationInput): PlanResult {
  try {
    const context = parse(contextSchema, input.context, PlanFailure.Context);
    parse(projectSchema, input.project, PlanFailure.Project);
    parse(supabaseSchema, input.supabase, PlanFailure.Supabase);
    const project = reviewMetadata(input.projectEnvironment);
    const shared = reviewMetadata(input.sharedEnvironment);
    const inherited = new Set([...project, ...shared].filter((e) =>
      e.gitBranch === null && e.target.includes("preview")).map((e) => e.key));
    if (!INHERITED_KEYS.every((key) => inherited.has(key))) refuse(PlanFailure.Incomplete);
    const credentials = parse(credentialsSchema, input.credentials, PlanFailure.Credentials);
    let databaseUrl: string;
    try { databaseUrl = validateDatabaseUrl(credentials.databaseUrl); }
    catch { return { ok: false, code: PlanFailure.Database }; }
    const databasePassword = decodeURIComponent(new URL(databaseUrl).password);
    if (credentials.testCronSecret === databasePassword) refuse(PlanFailure.Credentials);
    const previous = parse(authSchema, input.priorAuth, PlanFailure.Auth);
    const redirects = previous.uri_allow_list.split(",");
    if (!allowedAuthUrl(previous.site_url, false) || redirects.length > 8 ||
      new Set(redirects).size !== redirects.length ||
      redirects.some((url) => !allowedAuthUrl(url, true)) ||
      (redirects.length > 1 && redirects.includes(""))) refuse(PlanFailure.Auth);
    const values: Record<OverrideKey, string> = {
      STRAVA_REDIRECT_URI: "", ADMIN_EMAILS: "", STRAVA_WEBHOOK_SUBSCRIPTION_ID: "",
      STRAVA_CLIENT_SECRET: "", STRAVA_CLIENT_ID: "", STRAVA_WEBHOOK_CALLBACK_URL: "",
      STRAVA_WEBHOOK_VERIFY_TOKEN: "", MCP_TOKEN_SIGNING_KEY: "", AI_KEY_ENCRYPTION_KEY: "",
      CRON_SECRET: credentials.testCronSecret, NEXT_PUBLIC_SITE_URL: REVIEW.origin,
      NEXT_PUBLIC_SUPABASE_URL: REVIEW.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.publishableKey,
      SUPABASE_SERVICE_ROLE_KEY: credentials.secretKey, DATABASE_URL: databaseUrl,
      POOL_SWIMMING_ENABLED: "true", ENABLE_E2E_FIXTURES: "false",
      NEXT_PUBLIC_BUILD_SHA: context.expectedSha,
    };
    return { ok: true, plan: {
      proposedAlias: { hostname: REVIEW.proposedAlias, availability: "unverified" },
      environment: {
        operation: "create", upsert: false, preserved: { project, shared },
        overrides: OVERRIDE_KEYS.map((key) => ({
          key, value: values[key], type: "encrypted", target: ["preview"], gitBranch: REVIEW.branch,
        })),
      },
      auth: {
        previous,
        patch: { site_url: REVIEW.origin, uri_allow_list: `${REVIEW.origin}/auth/callback`,
          disable_signup: true },
      },
    } };
  } catch (code) {
    return { ok: false, code: Object.values(PlanFailure).includes(code as PlanFailure) ?
      code as PlanFailure : PlanFailure.Input };
  }
}

export function projectPlanMetadata(plan: ConfigurationPlan) {
  return plan.environment.overrides.map(({ key, target, gitBranch }) => ({
    key, target: [...target], gitBranch,
  }));
}
