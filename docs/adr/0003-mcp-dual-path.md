# ADR 0003 — MCP server + in-app chat dual path

**Status:** Retired 2026-08-06 — implementation removed by migration 0121
**Date:** 2026-05-28
**Phase:** D (follow-on to ADR 0002, before any AI surface ships)
**Supersedes (in part):** ADR 0002 §"First capability — Explain only" — specifically the *single-tool* / monolithic `getEngineSnapshot` decision. Everything else in ADR 0002 (BYOAI key vault, `LlmProvider` abstraction, eval harness, observability log, privacy contract, retry/tool-call limits, RLS posture) **remains in force**.

## Context

ADR 0002 locked the AI architecture around a single in-app, BYOAI-keyed Explain chat that calls one server-side tool (`getEngineSnapshot`) returning a tiered ~snapshot of profile + sessions + engine state + embedded knowledge. That design is sound but assumes the user wants to chat *inside this app*. In practice a meaningful share of the audience already lives in Claude.ai, ChatGPT, Cursor, or Gemini CLI and would rather pull training context into the tool they already use than learn a second chat surface.

The Model Context Protocol (MCP) — JSON-RPC 2.0 between **hosts**, **clients**, and **servers**, with Resources / Prompts / Tools as the server surface — is the cleanest way to expose this app's data to those external hosts. Remote MCP is now first-class on the host side: Anthropic's custom-connectors documentation confirms Claude calls remote MCP servers from Anthropic's cloud (network reachable from public internet, OAuth on the server), and the official `@modelcontextprotocol/server` TypeScript SDK ships a Streamable HTTP transport plus auth helpers suitable for hosting in our existing Next.js / Vercel deployment. Coros's recently-shipped training-data MCP server is a working public proof-of-concept for the same product shape we want.

The catch is that remote MCP today requires a paid Claude Pro / Max (or ChatGPT Plus / Pro) plan on the host side. Users on free Claude.ai or free ChatGPT cannot add custom connectors. So MCP alone is not a complete answer — we still need the in-app chat (ADR 0002, PR #187) for users on free AI accounts. The natural conclusion is **a dual path that shares a single tool catalogue**: write each tool once, expose it twice — internally to the in-app orchestrator, and externally over MCP. ADR 0002's monolithic `getEngineSnapshot` is the wrong shape for an external MCP host that wants to call narrow tools as needed, so this ADR decomposes it into a small typed catalogue used by both surfaces.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Shared tool catalogue | New `apps/web/src/lib/ai/tools/` directory; one TypeScript file per tool exporting `{ name, description, inputSchema, handler(input, ctx) }`. `ctx` carries the Supabase user-scoped client and `userId`. Read-only in v1 (matches ADR 0002) | Single source of truth; both the in-app orchestrator and the MCP server route call the same `handler`. Per-tool unit tests cover correctness for both surfaces |
| 2 | Tool decomposition | Replaces monolithic `getEngineSnapshot`. Initial 8: `getProfile`, `getActiveBlock`, `getRecentSessions(daysBack)`, `getWeeklyAggregates(weeksBack)`, `getPrTimeline(movement?)`, `getEngineState`, `getMemories`, `getKnowledge` | Narrow tools let the host pull only what it needs (cheaper context, more focused reasoning). Each call returns a small typed payload; the host composes a turn from several |
| 3 | MCP server route | Catch-all Next.js route `apps/web/src/app/mcp/[...mcp]/route.ts` using `@modelcontextprotocol/server` (Streamable HTTP transport, per spec [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18) and SDK `main` @ `5fc42e9`). Runs on Vercel serverless; no recurring infra cost | Streamable HTTP is the current remote transport (HTTP+SSE is deprecated for new servers). Catch-all route lets the SDK handle internal JSON-RPC routing |
| 4 | MCP authentication | OAuth 2.1 with Supabase Auth as the underlying identity provider. The MCP server issues short-lived bearer tokens after the user authorizes the external client (Claude, ChatGPT, Cursor, Gemini CLI). Per-user RLS-enforced data access — identical pattern to the in-app chat | Hybrid Training App account = identity. Tokens scope tool calls to one user; RLS does the rest. No service-role escalation in any tool handler |
| 5 | In-app chat refactor (PR B) | Orchestrator's tool list grows from 1 (`getEngineSnapshot`) to ~8 (the catalogue). Each call is a direct in-process function invocation of the catalogue `handler`, **not** an HTTP roundtrip to our own MCP endpoint. `LlmProvider`, vault, observability, eval harness, rate limiter, retry/tool-call limits stay byte-identical | Reuses ADR 0002 infra; mechanical migration. System prompt v2 documents the new repertoire (e.g. "use `getRecentSessions(14)` for last 2 weeks; `getWeeklyAggregates(12)` for 3-month trends") |
| 6 | Settings → AI dual-path UI | Two independent sections: **"Connect via MCP"** (region-aware URL + Copy button + expandable per-client connect instructions for Claude Pro / ChatGPT Plus / Cursor / Gemini CLI) and **"Use your AI API key"** (existing BYOAI flow from ADR 0002). User may configure either, both, or neither. In-app chat surface hides when neither is configured | Both paths first-class. MCP recommended for paid AI tool users; BYOAI is the fallback for free AI accounts |
| 7 | PR #192 disposition | **Park.** Do not merge. Re-evaluate after 4 weeks of dual-path usage data. Close if MCP usage dominates (model picker is BYOAI-only — irrelevant to MCP users, who use their AI tool's model) | Model picker is now a single-path feature with uncertain demand. Avoid maintenance cost until justified |
| 8 | Privacy posture | The privacy contract from ADR 0002 applies to both paths. Neither logs raw message content, raw tool args, or raw tool output. MCP path adds the property that the user's AI key never touches our DB. Full comparison in the table below | One contract, two surfaces. Metadata-only observability everywhere |
| 9 | Eval harness scope | Unchanged from ADR 0002. The harness covers the in-app chat surface (we control the LLM call there). MCP path is not eval-harness-covered end-to-end — the LLM is in the user's AI tool, outside our control. **Tool-level correctness is enforced by unit tests** on the catalogue, which both surfaces inherit. End-to-end MCP regression testing is deferred | Honest scoping. The unit tests are the right level for the shared layer; only the orchestrator-shaped seam needs cassette-based evals |
| 10 | Observability split | BYOAI in-app chat: continues writing to `ai_call_logs` (ADR 0002). MCP path: **new `mcp_tool_calls` table** capturing `user_id`, `tool_name`, `latency_ms`, `result_size_bytes`, `error_code`, `created_at`. Never tool input args (user-controlled text). Never tool output (user data). Same metadata-only privacy contract | New table chosen over a column on `ai_call_logs` because the row shapes barely overlap (no prompt hash, no provider, no usage tokens, no retry count on the MCP side). A separate table keeps both query patterns clean |

## Out of scope for v1

Explicit non-goals; each is a deliberate deferral, not an oversight.

- **No write tools in either path.** The catalogue is read-only. No edit-proposal, no log-set, no plan-mutation, no override-from-chat. Matches ADR 0002's read-only contract.
- **No multi-tenant org sharing.** Per-user only; OAuth scopes one user per token.
- **No paid managed-key tier for the in-app chat.** Still BYOAI only, per ADR 0002.
- **No multi-region deployment.** Single region initially; the URL is `/mcp/*` on the main app (or `mcp.<domain>` if we move the route under a subdomain later). Region-aware URL field in Settings exists for forward compatibility — initially shows one value.
- **No connector marketplace or curation.** Users paste a URL into their AI tool; we do not list third-party connectors or get listed in any directory beyond what Anthropic / OpenAI do automatically.
- **No MCP Resources or Prompts surfaces.** Only Tools. Resources (file-like context) and Prompts (templated workflows) are MCP features we are deliberately not exposing in v1; if a future need appears we add them additively.
- **No server-initiated MCP features.** No Sampling (asking the host's LLM to do work), no Roots, no Elicitation. We answer tool calls and that is all.
- **No streaming-back to MCP.** The spec supports streamed tool results; v1 returns discrete results. Reconsider if any tool's payload grows enough to matter.
- **No conversation compaction, no proactive triggers, no per-data-class redaction.** Inherited non-goals from ADR 0002.

## Privacy posture comparison

| | MCP path | BYOAI in-app path |
|---|---|---|
| Where the user's AI key lives | In the user's AI tool (Claude / ChatGPT / Cursor / Gemini CLI). **Never** in our DB | Encrypted in our DB via Supabase Vault (pgcrypto); only a vault ref + provider enum exposed server-side (ADR 0002) |
| What we see during a query | Tool name + arguments (e.g. `getRecentSessions(14)`) — captured as metadata only (`tool_name`, `result_size_bytes`, `latency_ms`); raw args **not** logged | Same tool-call metadata, **plus** we transit the user's message to the user's LLM provider via the user's key |
| What user data leaves our DB | Whatever the called tool returns — same scope and RLS context as the in-app path | Same scope |
| Conversation history persistence | In the user's AI tool only (we never see the transcript) | In our DB (`chat_threads` / `chat_messages` from ADR 0002), RLS-scoped |
| Provider training-opt-out | Enforced by the user's AI tool subscription (Claude Pro, ChatGPT Plus etc.) | Enforced by our outbound provider call (training-opt-out header / API setting) per ADR 0002 |
| Master opt-in | `ai_opt_in` flag still gates both. Off → MCP server returns `unauthorized` for tool calls and the Settings panel hides both sections' active state | Same |

The ADR 0002 privacy invariants — never log raw prompt text, never log raw tool args, never log raw tool output, default to vendor training-opt-out — apply on both paths.

## Architecture

### Tool catalogue interface

A single shared interface lives at `apps/web/src/lib/ai/tools/index.ts`. Each tool file exports an object that matches:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface ToolContext {
  userId: string;
  supabase: SupabaseClient;
}

export interface CatalogueTool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: StandardSchemaV1<TInput>;
  handler(input: TInput, ctx: ToolContext): Promise<TOutput>;
}
```

`inputSchema` uses Standard Schema (Zod v4 as the concrete library) so the same schema feeds both:

- the in-app orchestrator's tool-list declaration (translated to each `LlmProvider`'s native shape), and
- the MCP server's `registerTool` call (the SDK accepts Standard Schema directly per the TypeScript SDK README, `main` @ `5fc42e9`).

Handlers receive a Supabase client already bound to the caller's RLS context. Tools **never** instantiate a service-role client; if a query needs to bypass RLS, that is a separate ADR.

### Initial 8 tools

| Tool | Input | Output (typed) | Data source | Hard caps |
|---|---|---|---|---|
| `getProfile` | — | experience tier, archetype preferences, equipment, declared active limitations | `profiles` + `limitations WHERE resolved_at IS NULL` | one row + ≤ 50 active limitations |
| `getActiveBlock` | — | current archetype, week index, prescribed sessions for next 2 weeks | `training_blocks WHERE status='active'` + `planned_sessions` next 14 days; helpers from `apps/web/src/lib/planner/queries.ts` | ≤ 14 prescribed sessions |
| `getRecentSessions` | `{ daysBack: number }` | per-day strength + cardio sessions at daily detail | `sessions` ⨝ `set_logs` ⨝ `cardio_logs` filtered by `performed_at >= now() - daysBack days`; reuse the existing `apps/web/src/lib/engine/actual-session-load.ts` aggregations | `daysBack` clamped to **[1, 90]**; ≤ 200 sessions |
| `getWeeklyAggregates` | `{ weeksBack: number }` | weekly tonnage, weekly cardio minutes, weekly adherence | `sessions` grouped by `date_trunc('week', performed_at)`; helpers from `apps/web/src/lib/stats/blocks.ts` | `weeksBack` clamped to **[1, 104]** |
| `getPrTimeline` | `{ movement?: string }` | full PR history, optionally filtered to a movement | `pr_events` table via `apps/web/src/lib/stats/pr-queries.ts` | ≤ 500 most recent PRs (or all if < 500) |
| `getEngineState` | — | current bucket pressure, region freshness (ATL/CTL), ceiling-explain output, taper recommendation | `getBucketPressure` + `getRegionFreshness` + `getCeilingExplain` from `apps/web/src/lib/stats/engine.ts` | fixed shape: 5 buckets + 7 regions + 1 ceiling row |
| `getMemories` | — | current `memories` rows for this user (read-only) | `memories WHERE user_id = auth.uid()` | ≤ 100 most recent |
| `getKnowledge` | — | embedded archetype descriptions + CP-1..CP-5 policy + 30-row CP-2 constants table | static TypeScript constant in `apps/web/src/lib/ai/knowledge.ts` (compile-time) | bounded by source-file size (≤ 5k tokens) |

The legacy `getEngineSnapshot` is **removed** in PR B (no deprecation window — it never shipped to users; ADR 0002's PR #187 was open at the time this ADR was accepted).

### MCP server route

```
apps/web/src/app/mcp/[...mcp]/route.ts
```

A catch-all Next.js App Router handler that delegates to the MCP SDK's Streamable HTTP transport. Sketch:

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { StreamableHttpServerTransport } from "@modelcontextprotocol/server/streamableHttp";
import { catalogue } from "@/lib/ai/tools";
import { requireMcpBearerAuth } from "@/lib/ai/mcp/auth";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: { mcp: string[] } }) {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: { params: { mcp: string[] } }) {
  return handle(req, ctx);
}

async function handle(req: Request, _ctx: { params: { mcp: string[] } }): Promise<Response> {
  const auth = await requireMcpBearerAuth(req); // -> { userId, supabase } | 401
  if (!auth.ok) return auth.response;

  const server = new McpServer({ name: "hybrid-training", version: "1.0.0" });
  for (const tool of catalogue) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input) => {
        const output = await tool.handler(input, auth.ctx);
        return { content: [{ type: "text", text: JSON.stringify(output) }] };
      },
    );
  }

  const transport = new StreamableHttpServerTransport(/* …adapted to Web fetch Request/Response… */);
  return transport.handle(req, server);
}
```

Notes:

- **Package name** confirmed from the SDK README (`main` @ `5fc42e9`): **`@modelcontextprotocol/sdk`** at v1.x (the production-recommended track). The v2 `@modelcontextprotocol/server` package is pre-alpha and explicitly not chosen for v1 of this work. PR A pins `@modelcontextprotocol/sdk@^1.x` (latest 1.x at PR-open time) in `apps/web/package.json`. If the v1 line is later deprecated, that is a follow-up ADR.
- **Transport**: Streamable HTTP, per [spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18). The deprecated HTTP+SSE transport is **not** implemented.
- Each MCP request rebuilds an `McpServer` bound to the authenticated user's RLS context. This is stateless across requests (Vercel serverless friendly) and keeps per-user isolation explicit.

### OAuth 2.1 + Supabase Auth bridge

```
apps/web/src/lib/ai/mcp/auth.ts          // requireMcpBearerAuth, token mint, token verify
apps/web/src/app/mcp/authorize/route.ts  // OAuth authorization endpoint (redirects to Supabase login if needed)
apps/web/src/app/mcp/token/route.ts      // OAuth token endpoint (exchanges code for short-lived access token)
```

- The external client (Claude / ChatGPT / Cursor) follows OAuth 2.1 against `/mcp/authorize` and `/mcp/token`.
- Authorization redirects to the user's Supabase Auth session (already-logged-in users see only a consent screen; logged-out users sign in first).
- On consent we issue a **bearer token with a 1-hour lifetime** signed with a server-only secret; the token payload binds `{ userId, clientId, scope }`. The 1-hour value is the v1 fixed default — long enough to span a normal chat session, short enough that a leaked token's blast radius is small. No refresh tokens in v1 (the user re-authorizes when the token expires; refresh-token support is deferred to a follow-up ADR if the re-authorize prompt becomes a real friction signal in usage data).
- Each MCP request goes through `requireMcpBearerAuth`, which verifies the token and returns a `ToolContext` carrying a Supabase client signed in as that user via the standard server-side helper (matches the in-app chat's RLS posture).
- Every `authorize` / `token` / `revoke` event writes to `mcp_authorizations` (see schema below).

### In-app chat orchestrator refactor

`apps/web/src/lib/ai/orchestrator.ts` swaps its tool list from `[getEngineSnapshotTool]` to `catalogue`. Each tool call resolves to `tool.handler(input, ctx)` directly — no HTTP, no MCP layer in between. The system prompt is bumped to `system.v2.ts` (per ADR 0002's prompt-versioning discipline, this invalidates eval cassettes; PR B re-records them).

Everything else from ADR 0002 is untouched: `LlmProvider` interface, the three provider adapters, the vault, `hasAiAccess` gate, `ai_call_logs`, the eval harness modes, the retry/tool-call cap (max 2 retries, max 6 tool calls — comfortably above the 8-tool catalogue's expected per-turn fan-out).

### Schema additions

PR A ships two additive migrations.

```sql
-- New observability table for the MCP path.
-- Separate from ai_call_logs because the row shapes barely overlap.
create table mcp_tool_calls (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  tool_name         text not null,
  latency_ms        int  not null,
  result_size_bytes int  not null,
  error_code        text,                                     -- nullable; one of the normalised codes
  created_at        timestamptz not null default now()
);

-- One row per (user, external client) authorization lifecycle event.
-- 'authorize' on consent, 'revoke' on user-initiated disconnect or admin revoke.
create table mcp_authorizations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text not null,                                 -- e.g. 'claude-web', 'chatgpt', 'cursor', 'gemini-cli'
  event        text not null,                                 -- 'authorize' | 'revoke'
  scope        text,                                          -- space-separated scope string
  created_at   timestamptz not null default now()
);
```

RLS on both tables: user reads only own rows; writes are server-only (no client write path). `mcp_tool_calls` never stores tool input args or tool output. `mcp_authorizations` never stores token material.

PR A also extends `packages/db/integration-tests/rls.mjs` to assert isolation on both new tables.

## Consequences

- **Tool catalogue refactor (modest).** ~8 small files, each with one handler and one Zod schema; ~600–900 lines including unit tests. Replaces a single ~snapshot builder.
- **MCP server new code (~300–500 lines + OAuth).** Catch-all route + transport glue + OAuth authorize/token/verify + token-signing key wiring. OAuth is the largest chunk; everything else is thin SDK glue.
- **Settings UI dual-path.** Two stacked sections, both independently configurable; existing BYOAI section unchanged in mechanics, only re-titled.
- **PR #192 model picker parked.** No new code from #192 enters `main`; revisit in 4 weeks against usage data.
- **Eval harness scope unchanged.** Still covers the in-app chat surface only; gains coverage on the 8 catalogue tools via per-tool unit tests (which are a normal test-suite addition, not a harness change).
- **New observability surface.** `mcp_tool_calls` table + RLS test extension; metadata-only, same privacy invariants as `ai_call_logs`.
- **Prompt v2 in PR B.** Bumping `system.v1.ts` → `system.v2.ts` invalidates cassettes by design; PR B re-records the 5 ADR-0002 fixtures against the new tool repertoire.
- **CP-1..CP-5 still binds.** The catalogue's embedded knowledge in `getKnowledge` is sourced from the same constraint files via compile-time import; no parallel copy.

## Implementation split

Both PRs land before any user-visible AI surface ships. Neither is in scope for this ADR PR.

- **PR A — Tool catalogue + MCP server route + Settings UI MCP section.**
  - Add `apps/web/src/lib/ai/tools/` (8 tools + index + types + per-tool unit tests).
  - Add `apps/web/src/app/mcp/[...mcp]/route.ts` + `apps/web/src/lib/ai/mcp/{auth,token}.ts` + `apps/web/src/app/mcp/{authorize,token}/route.ts`.
  - Migrations: `mcp_tool_calls`, `mcp_authorizations`; RLS test extensions.
  - Settings → AI: add the **"Connect via MCP"** section (URL + Copy + per-client connect instructions); leave the existing BYOAI section untouched.
  - Pin `@modelcontextprotocol/server` (or `@modelcontextprotocol/sdk` v1.x, decided at PR-open time) in `package.json`.
- **PR B — Orchestrator refactor to consume the catalogue; drop monolithic `getEngineSnapshot`.**
  - Rewrite the orchestrator's tool list to `catalogue`.
  - Replace `system.v1.ts` with `system.v2.ts` describing the new repertoire.
  - Delete `getEngineSnapshot` and its snapshot-builder helper.
  - Re-record the 5 eval cassettes against the new prompt hash.
  - No schema migrations; no Settings UI changes.

## Verification gates

The ADR is correctly implemented after both PRs land iff:

1. **Tool catalogue is the single source of truth.** A grep for `getEngineSnapshot` in `apps/web/src` returns zero matches. Both the in-app orchestrator and the MCP route import the same `catalogue` module.
2. **MCP server passes the SDK conformance ping.** A local MCP client (the SDK's `@modelcontextprotocol/client`) can connect to `/mcp/*` over Streamable HTTP using a bearer token minted by `/mcp/token`, list all 8 tools, and call any one of them successfully — proven by a Node integration test in `apps/web/tests/mcp/`.
3. **Per-user RLS isolation across both paths.** `packages/db/integration-tests/rls.mjs` proves a user cannot read another user's `mcp_tool_calls` or `mcp_authorizations`, and that an MCP token minted for user A cannot return user B's profile, sessions, or PRs from any catalogue tool.
4. **Observability privacy invariants hold.** A privacy test grep-asserts that `mcp_tool_calls` rows contain no field carrying tool input args or tool output bytes, only the metadata columns declared above. The same test continues to pass for `ai_call_logs` per ADR 0002.
5. **Settings dual-path UX is consistent.** With `ai_opt_in = false` neither section accepts configuration; with `ai_opt_in = true` the user can independently configure MCP, BYOAI, both, or neither. The in-app chat FAB renders iff BYOAI is configured; the MCP URL is copyable iff MCP authorization is enabled. RLS-isolated end-to-end Playwright test covers all four states.

## Open follow-ups

Each will get its own ADR or PR when picked up.

- **PR #192 disposition decision** at the 4-week mark — merge if BYOAI dominates, close if MCP dominates, defer further if mixed.
- **MCP usage analytics** — decide pre-launch whether to add a Settings-visible "last connected via MCP" timestamp; current plan ships without it.
- **Regional MCP deployments** — if the user base grows beyond a single region, add `us` / `eu` / `cn` URLs and a region picker in Settings (the field already exists, single-valued).
- **Refresh tokens for MCP OAuth** — v1 issues access tokens only; long-lived refresh tokens are a follow-up.
- **MCP Resources / Prompts surfaces** — additive; only if a concrete user need appears.
- **Streaming MCP tool results** — only if any tool's payload grows enough to matter.
- **Write-capable tools (both paths)** — still deferred per ADR 0002; will get its own ADR covering the override-and-warn contract (DC-K4 alignment).
- **End-to-end MCP regression testing** — deferred; tool-level unit tests are the v1 contract.

---

*Resolves the dual-path question raised after ADR 0002 was accepted but before its implementation PRs (#187 onward) merged. Cited external sources: MCP specification version [2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18); `@modelcontextprotocol/typescript-sdk` `main` branch at commit `5fc42e9be115a8865cca42541bb50183dc2e8b93` (README + `examples/server/README.md`); Anthropic custom-connectors documentation ([article 11175166](https://support.anthropic.com/en/articles/11175166-about-custom-connectors-using-remote-mcp)) for the remote-host network and authentication requirements.*
