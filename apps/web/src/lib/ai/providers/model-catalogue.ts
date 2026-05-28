/**
 * Curated model catalogue per provider.
 *
 * Source of truth for:
 *   - the Settings → AI model picker dropdown,
 *   - the per-provider default model (Recommended tier),
 *   - membership checks when the user picks a curated entry.
 *
 * Custom model IDs (typed into the panel's "Use a custom model ID"
 * box) are NOT constrained by this list — they are validated against
 * the provider's live `/models` endpoint by `setByoaiKey`.
 *
 * Model IDs verified against vendor docs on 2026-05-28:
 *   - Anthropic: https://docs.claude.com/en/docs/about-claude/models
 *   - OpenAI:    https://platform.openai.com/docs/models  (docs UI
 *                returned 403 to fetch; IDs cross-referenced against
 *                Wikipedia GPT-5/5.1/5.2/5.4 articles and OpenAI's
 *                release notes — flagged "fallback" below where the
 *                live docs page was unreachable).
 *   - Gemini:    https://ai.google.dev/gemini-api/docs/models +
 *                Wikipedia Gemini stable-release matrix.
 *
 * The default tier per provider is "recommended" — NOT the most
 * capable. We surface the cheaper tiers right next to it so users
 * can opt down to "fast_cheap" or up to "most_capable" knowing what
 * they're picking.
 */
import type { LlmProviderName } from "./types";

export type ModelTier = "most_capable" | "recommended" | "fast_cheap";

export type ModelOption = {
  /** Exact model ID accepted by the provider's API. */
  id: string;
  /** Human-friendly display name. */
  label: string;
  tier: ModelTier;
  /** Rough relative cost band. See pricing page for exact rates. */
  costBand: "$" | "$$" | "$$$" | "$$$$";
  /** Optional short caveat ("preview", "no tool use", etc.). */
  note?: string;
};

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  most_capable: "Most capable",
  recommended: "Recommended",
  fast_cheap: "Fast & cheap",
};

export const PROVIDER_PRICING_URL: Record<LlmProviderName, string> = {
  anthropic: "https://www.anthropic.com/pricing#api",
  openai: "https://openai.com/api/pricing/",
  gemini: "https://ai.google.dev/gemini-api/docs/pricing",
};

export const MODEL_OPTIONS: Record<LlmProviderName, ModelOption[]> = {
  anthropic: [
    {
      id: "claude-opus-4-7",
      label: "Claude Opus 4.7",
      tier: "most_capable",
      costBand: "$$$$",
      note: "Best for hard reasoning + agentic coding",
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      tier: "recommended",
      costBand: "$$$",
      note: "Best balance of speed + intelligence",
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      tier: "fast_cheap",
      costBand: "$",
      note: "Near-frontier intelligence at lowest latency",
    },
  ],
  openai: [
    {
      id: "gpt-5.4",
      label: "GPT-5.4",
      tier: "most_capable",
      costBand: "$$$$",
      note: "Frontier reasoning + deep research (Mar 2026)",
    },
    {
      id: "gpt-5.1",
      label: "GPT-5.1",
      tier: "recommended",
      costBand: "$$$",
      note: "Stable mainstream model, good default cost/quality",
    },
    {
      id: "gpt-5-mini",
      label: "GPT-5 mini",
      tier: "fast_cheap",
      costBand: "$",
      note: "Cheapest workhorse — fast, follows simple prompts well",
    },
  ],
  gemini: [
    {
      id: "gemini-3.1-pro",
      label: "Gemini 3.1 Pro",
      tier: "most_capable",
      costBand: "$$$",
      note: "Deepest reasoning + 1M-token context",
    },
    {
      id: "gemini-3.5-flash",
      label: "Gemini 3.5 Flash",
      tier: "recommended",
      costBand: "$$",
      note: "Frontier-class Flash, stable since May 2026",
    },
    {
      id: "gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash-Lite",
      tier: "fast_cheap",
      costBand: "$",
      note: "Cheapest tier for high-volume low-latency calls",
    },
  ],
};

/**
 * Default model per provider = the Recommended-tier entry.
 *
 * Cost-conservative on purpose: most chats don't need frontier
 * reasoning, and the user can opt up explicitly via the picker.
 */
export function getDefaultModel(provider: LlmProviderName): string {
  const options = MODEL_OPTIONS[provider];
  const recommended = options.find((o) => o.tier === "recommended");
  if (!recommended) {
    // Catalogue invariant — every provider must have a recommended
    // entry. Fall back to the first listed model so callers never
    // crash on a malformed catalogue in production.
    return options[0]?.id ?? "";
  }
  return recommended.id;
}

/**
 * Look up a curated option by ID. Returns null when the ID is a
 * custom string the user pasted in.
 */
export function findCuratedOption(
  provider: LlmProviderName,
  id: string,
): ModelOption | null {
  return MODEL_OPTIONS[provider].find((o) => o.id === id) ?? null;
}

/**
 * Human label for a model ID — uses the catalogue's label when the
 * ID is curated, otherwise echoes the raw ID prefixed with "Custom: ".
 */
export function describeModel(
  provider: LlmProviderName,
  id: string,
): string {
  const curated = findCuratedOption(provider, id);
  if (curated) return curated.label;
  return `Custom: ${id}`;
}

/** Shape validator for the custom model ID input. */
export function validateCustomModelId(
  id: string,
): { ok: true } | { ok: false; reason: string } {
  if (typeof id !== "string") {
    return { ok: false, reason: "Model ID must be a string." };
  }
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Model ID cannot be empty." };
  }
  if (trimmed.length > 200) {
    return { ok: false, reason: "Model ID is too long (max 200 chars)." };
  }
  // Permissive character set: vendors use letters, digits, dots,
  // dashes, underscores, slashes, colons, and @ for versioning.
  if (!/^[A-Za-z0-9._\-:/@]+$/.test(trimmed)) {
    return {
      ok: false,
      reason:
        "Model ID contains unsupported characters. Allowed: letters, digits, . _ - : / @",
    };
  }
  return { ok: true };
}
