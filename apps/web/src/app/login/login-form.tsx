"use client";

import { useActionState, useState } from "react";
import {
  signIn,
  signInWithMagicLink,
  signUp,
} from "@/lib/auth/actions";

type Result = { error?: string; ok?: boolean; message?: string } | null;

async function signInAction(_prev: Result, formData: FormData): Promise<Result> {
  return signIn(formData);
}
async function signUpAction(_prev: Result, formData: FormData): Promise<Result> {
  return signUp(formData);
}
async function magicLinkAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  return signInWithMagicLink(formData);
}

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [signInState, signInForm, signInPending] = useActionState(
    signInAction,
    null,
  );
  const [signUpState, signUpForm, signUpPending] = useActionState(
    signUpAction,
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
        {tab("signup", "Sign up")}
        {tab("magic", "Magic link")}
      </div>

      {mode === "signin" && (
        <form action={signInForm} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="••••••••"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <button
            type="submit"
            disabled={signInPending}
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

      {mode === "signup" && (
        <form action={signUpForm} className="space-y-3">
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <button
            type="submit"
            disabled={signUpPending}
            className="cp-btn primary big"
            style={{ width: "100%" }}
          >
            {signUpPending ? "Creating account…" : "Create account"}
          </button>
          {signUpState?.error && (
            <p className="text-sm text-red-600">{signUpState.error}</p>
          )}
          {signUpState?.ok && (
            <p className="text-sm text-emerald-600">
              Check your email to confirm your account.
            </p>
          )}
        </form>
      )}

      {mode === "magic" && (
        <form action={magicForm} className="space-y-3">
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <button
            type="submit"
            disabled={magicPending}
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
