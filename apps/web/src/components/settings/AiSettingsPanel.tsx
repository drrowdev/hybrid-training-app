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
  const [showKeyInfo, setShowKeyInfo] = useState(false);
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
              <span className="inline-flex items-center gap-1.5">
                API key
                <KeyStorageInfoButton
                  open={showKeyInfo}
                  onToggle={() => setShowKeyInfo((v) => !v)}
                />
              </span>
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
            {showKeyInfo && <KeyStorageInfoPanel provider={provider} />}
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

function KeyStorageInfoButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label="How is my key stored?"
      title="How is my key stored?"
      data-testid="ai-key-storage-info-toggle"
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-foreground/30 text-[10px] font-semibold leading-none text-foreground/70 hover:bg-foreground/10"
    >
      i
    </button>
  );
}

function KeyStorageInfoPanel({
  provider,
}: {
  provider: Provider;
}): React.ReactElement {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div
      role="region"
      aria-label="Key storage details"
      data-testid="ai-key-storage-info-panel"
      className="mt-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3 text-xs text-foreground/80 leading-relaxed space-y-3"
    >
      <p className="text-sm font-medium text-foreground">
        Your key stays yours.
      </p>
      <ul className="space-y-2 pl-0 list-none">
        <li>
          <strong>Bank-level encryption.</strong> The moment you click Save,
          your key is immediately encrypted. The password used to lock it
          lives entirely outside our database. Even in the absolute worst-case
          scenario of a database breach, your raw key remains unreadable to
          outsiders and to our own team — the encryption password never
          lives in the same place as the encrypted data.
        </li>
        <li>
          <strong>Hidden permanently.</strong> This is a write-only input.
          Once saved, the key is wiped from the screen and can never be
          retrieved or displayed by this app again.
        </li>
        <li>
          <strong>Memory-only processing.</strong> Your key is only
          decrypted in temporary server memory for the brief moment
          required to send your request to {PROVIDER_LABEL[provider]}. It
          is never written to log files, cached, or saved anywhere
          permanently.
        </li>
        <li>
          <strong>Instant revocation.</strong> Clicking Clear immediately
          and permanently purges the encrypted key from our servers.
          Because you own the key, you also maintain total control to
          pause, limit, or delete it instantly from your{" "}
          {PROVIDER_LABEL[provider]} dashboard.
        </li>
      </ul>
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        data-testid="ai-key-storage-technical-toggle"
        className="text-xs text-foreground/60 underline hover:text-foreground/80"
      >
        {showDetails ? "Hide technical details" : "Technical details"}
      </button>
      {showDetails && (
        <div
          data-testid="ai-key-storage-technical-details"
          className="space-y-2 border-t border-foreground/10 pt-3 text-foreground/65"
        >
          <p>
            Keys are encrypted at rest using pgcrypto symmetric encryption.
            The master key is sourced from a server-runtime environment
            variable, never stored in the database. Decryption happens
            exclusively in server-side code via a SECURITY DEFINER
            Postgres function that requires both the vault reference AND
            your user ID to match — a leaked vault reference alone cannot
            cross account boundaries.
          </p>
          <p>
            Audit events (set / replace / clear) are recorded with a
            timestamp and the provider name. No key value, no partial
            fragment, no derived hash is ever stored. Per-chat logs
            capture only metadata (token counts, latency, error codes);
            raw message content is rejected at the type level before it
            can reach the log writer.
          </p>
        </div>
      )}
    </div>
  );
}
