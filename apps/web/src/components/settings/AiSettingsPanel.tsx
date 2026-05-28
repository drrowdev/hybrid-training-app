"use client";

/**
 * Settings → AI panel. ADR 0002, PR 1.
 *
 * Renders:
 *   - master opt-in toggle (`ai-opt-in-toggle`)
 *   - provider picker (`ai-provider-select`)
 *   - API-key entry + show/hide + save (`ai-key-input`, `ai-key-save`)
 *   - "Key configured · Replace" / "Clear" controls when a key is set
 *     (`ai-key-replace`, `ai-key-clear`)
 *   - privacy disclosure block with per-provider opt-out doc link
 *
 * The form NEVER displays a saved key back. Server actions encrypt
 * and store on submit; the input is cleared on success.
 */

import { useState, useTransition } from "react";
import {
  clearByoaiKey,
  setAiOptIn,
  setByoaiKey,
} from "@/lib/ai/actions";

type Provider = "anthropic" | "openai" | "gemini";

const PROVIDER_OPTIONS: Array<{ value: Provider; label: string }> = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "gemini", label: "Google Gemini" },
];

const TRAINING_OPT_OUT_DOC: Record<Provider, string> = {
  anthropic:
    "https://privacy.anthropic.com/en/articles/10023555-how-do-you-use-personal-data-in-model-training",
  openai: "https://platform.openai.com/docs/models/how-we-use-your-data",
  gemini: "https://ai.google.dev/gemini-api/terms",
};

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

export function AiSettingsPanel({
  initialOptedIn,
  initialProvider,
  initialKeyConfigured,
}: {
  initialOptedIn: boolean;
  initialProvider: Provider | null;
  initialKeyConfigured: boolean;
}) {
  const [optedIn, setOptedIn] = useState(initialOptedIn);
  const [provider, setProvider] = useState<Provider>(
    initialProvider ?? "anthropic",
  );
  const [keyConfigured, setKeyConfigured] = useState(initialKeyConfigured);
  const [replaceMode, setReplaceMode] = useState(!initialKeyConfigured);
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggleOptIn = () => {
    const next = !optedIn;
    setOptedIn(next);
    startTransition(async () => {
      const r = await setAiOptIn(next);
      if (!r.ok) {
        setError(r.errors.join("; "));
        setOptedIn(!next);
      } else {
        setStatus(next ? "AI features on." : "AI features off.");
      }
    });
  };

  const saveKey = () => {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const r = await setByoaiKey(provider, keyValue);
      if (r.ok) {
        setKeyConfigured(true);
        setReplaceMode(false);
        setKeyValue("");
        setShowKey(false);
        setStatus(`${PROVIDER_LABEL[provider]} key saved.`);
      } else {
        setError(r.errors.join("; "));
      }
    });
  };

  const clearKey = () => {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const r = await clearByoaiKey();
      if (r.ok) {
        setKeyConfigured(false);
        setReplaceMode(true);
        setStatus("Key cleared.");
      } else {
        setError(r.errors.join("; "));
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Opt-in */}
      <div
        className="rounded-lg border border-foreground/10 p-4 space-y-2"
        data-testid="ai-opt-in-section"
      >
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={optedIn}
            onChange={toggleOptIn}
            disabled={isPending}
            data-testid="ai-opt-in-toggle"
          />
          <span className="text-sm">
            Enable AI features
            <span className="block text-xs text-foreground/60 mt-1">
              Master switch. With this off, no AI route accepts work and
              no data leaves the app.
            </span>
          </span>
        </label>
      </div>

      {/* Provider picker */}
      <div
        className="rounded-lg border border-foreground/10 p-4 space-y-3"
        data-testid="ai-provider-section"
      >
        <label className="block text-sm">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            disabled={isPending}
            data-testid="ai-provider-select"
            className="mt-2 block w-full rounded border border-foreground/10 bg-transparent p-2 text-sm"
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Key entry */}
      <div
        className="rounded-lg border border-foreground/10 p-4 space-y-3"
        data-testid="ai-key-section"
      >
        {keyConfigured && !replaceMode ? (
          <div className="space-y-2">
            <p className="text-sm">
              Key configured for {PROVIDER_LABEL[provider]}.
              <span className="block text-xs text-foreground/60 mt-1">
                Stored encrypted at rest. The app never displays it back to
                you.
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReplaceMode(true)}
                disabled={isPending}
                data-testid="ai-key-replace"
                className="rounded border border-foreground/10 px-3 py-1 text-sm hover:bg-foreground/5"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={clearKey}
                disabled={isPending}
                data-testid="ai-key-clear"
                className="rounded border border-foreground/10 px-3 py-1 text-sm hover:bg-foreground/5"
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm">
              API key
              <div className="mt-2 flex gap-2">
                <input
                  type={showKey ? "text" : "password"}
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  disabled={isPending}
                  data-testid="ai-key-input"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 rounded border border-foreground/10 bg-transparent p-2 text-sm font-mono"
                  placeholder={`Your ${PROVIDER_LABEL[provider]} API key`}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  data-testid="ai-key-show-toggle"
                  className="rounded border border-foreground/10 px-3 py-1 text-xs hover:bg-foreground/5"
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveKey}
                disabled={isPending || keyValue.length < 8}
                data-testid="ai-key-save"
                className="rounded border border-foreground/10 px-3 py-1 text-sm hover:bg-foreground/5 disabled:opacity-50"
              >
                Save key
              </button>
              {keyConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    setReplaceMode(false);
                    setKeyValue("");
                  }}
                  disabled={isPending}
                  className="rounded border border-foreground/10 px-3 py-1 text-sm hover:bg-foreground/5"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {status && (
          <p
            className="text-xs text-foreground/70"
            data-testid="ai-status"
            role="status"
          >
            {status}
          </p>
        )}
        {error && (
          <p
            className="text-xs text-red-600"
            data-testid="ai-error"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      {/* Privacy disclosure */}
      <div
        className="rounded-lg border border-foreground/10 p-4 space-y-2"
        data-testid="ai-privacy-block"
      >
        <p className="text-xs text-foreground/70 leading-relaxed">
          Your messages and a per-session snapshot of your training data are
          sent to your selected provider. By default, providers do not train
          on API requests; the linked docs explain this in detail.
        </p>
        <ul className="text-xs text-foreground/60 space-y-1 pl-4 list-disc">
          {PROVIDER_OPTIONS.map((opt) => (
            <li key={opt.value}>
              <a
                href={TRAINING_OPT_OUT_DOC[opt.value]}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                data-testid={`ai-privacy-link-${opt.value}`}
              >
                {opt.label} — training opt-out
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
