"use client";

import { useActionState, useState } from "react";
import { signIn, sendEmailCode, verifyEmailCode } from "@/lib/auth/actions";

type Result = { error?: string; ok?: boolean; message?: string } | null;

async function signInAction(_prev: Result, formData: FormData): Promise<Result> {
  return signIn(formData);
}
async function sendCodeAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  return sendEmailCode(formData);
}
async function verifyCodeAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  return verifyEmailCode(formData);
}

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "code">("signin");
  const [email, setEmail] = useState("");
  const [backToRequest, setBackToRequest] = useState(false);

  const [signInState, signInForm, signInPending] = useActionState(
    signInAction,
    null,
  );
  const [sendState, sendForm, sendPending] = useActionState(
    sendCodeAction,
    null,
  );
  const [verifyState, verifyForm, verifyPending] = useActionState(
    verifyCodeAction,
    null,
  );

  // Show the code-entry step once the email is sent, unless the user has
  // backed out to change their address (reset on the next send submit).
  const codeStep: "request" | "verify" =
    sendState?.ok && !backToRequest ? "verify" : "request";

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
        {tab("code", "Email code")}
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

      {mode === "code" && codeStep === "request" && (
        <form
          action={sendForm}
          onSubmit={() => setBackToRequest(false)}
          className="space-y-3"
          data-testid="auth-form-code"
        >
          <input
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            data-testid="auth-email-input"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2"
          />
          <button
            type="submit"
            disabled={sendPending}
            data-testid="auth-submit"
            className="cp-btn primary big"
            style={{ width: "100%" }}
          >
            {sendPending ? "Sending code…" : "Email me a 6-digit code"}
          </button>
          {sendState?.error && (
            <p className="text-sm text-red-600">{sendState.error}</p>
          )}
        </form>
      )}

      {mode === "code" && codeStep === "verify" && (
        <form action={verifyForm} className="space-y-3" data-testid="auth-form-verify">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="email" value={email} />
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code we emailed to <strong>{email}</strong>.
          </p>
          <input
            name="token"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            placeholder="123456"
            data-testid="auth-code-input"
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 tracking-[0.4em] text-center"
          />
          <button
            type="submit"
            disabled={verifyPending}
            data-testid="auth-submit"
            className="cp-btn primary big"
            style={{ width: "100%" }}
          >
            {verifyPending ? "Verifying…" : "Verify code"}
          </button>
          {verifyState?.error && (
            <p className="text-sm text-red-600">{verifyState.error}</p>
          )}
          {sendState?.message && !verifyState?.error && (
            <p className="text-sm text-emerald-600">{sendState.message}</p>
          )}
          <button
            type="button"
            onClick={() => setBackToRequest(true)}
            className="cp-btn ghost"
            data-testid="auth-code-change-email"
            style={{ width: "100%", minHeight: 36, fontSize: 13 }}
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
