"use client";

import { useActionState, useState } from "react";
import { signIn, signInWithMagicLink } from "@/lib/auth/actions";

type Result = { error?: string; ok?: boolean; message?: string } | null;

async function signInAction(_prev: Result, formData: FormData): Promise<Result> {
  return signIn(formData);
}
async function magicLinkAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  return signInWithMagicLink(formData);
}

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "magic">("signin");
  const [signInState, signInForm, signInPending] = useActionState(
    signInAction,
    null,
  );
  const [magicState, magicForm, magicPending] = useActionState(
    magicLinkAction,
    null,
  );

  const tab = (k: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(k)}
      className="cp-btn ghost"
      data-testid={`auth-tab-${k}`}
      style={{
        padding: "8px 12px",
        minHeight: 36,
        fontSize: 13,
        background: mode === k ? "var(--cp-accent)" : "transparent",
        color: mode === k ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
        borderColor: mode === k ? "var(--cp-accent)" : "transparent",
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="w-full max-w-sm space-y-4">
      <div className="flex gap-1 p-1 rounded-lg bg-foreground/5 w-fit">
        {tab("signin", "Sign in")}
        {tab("magic", "Magic link")}
      </div>

      {mode === "signin" && (
        <form action={signInForm} className="space-y-3" data-testid="auth-form-signin">
          <input type="hidden" name="next" value={next} />
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            data-testid="auth-email-input"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="••••••••"
            data-testid="auth-password-input"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <button
            type="submit"
            disabled={signInPending}
            data-testid="auth-submit"
            className="cp-btn primary big"
            style={{ width: "100%" }}
          >
            {signInPending ? "Signing in…" : "Sign in"}
          </button>
          {signInState?.error && (
            <p className="text-sm text-red-600">{signInState.error}</p>
          )}
        </form>
      )}

      {mode === "magic" && (
        <form action={magicForm} className="space-y-3" data-testid="auth-form-magic">
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            data-testid="auth-email-input"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <button
            type="submit"
            disabled={magicPending}
            data-testid="auth-submit"
            className="cp-btn primary big"
            style={{ width: "100%" }}
          >
            {magicPending ? "Sending link…" : "Email me a sign-in link"}
          </button>
          {magicState?.error && (
            <p className="text-sm text-red-600">{magicState.error}</p>
          )}
          {magicState?.message && (
            <p className="text-sm text-emerald-600">{magicState.message}</p>
          )}
        </form>
      )}
    </div>
  );
}
