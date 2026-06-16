"use client";

/**
 * Client wrappers around the Strava connection server actions so the
 * buttons can show a pending state (the page otherwise feels frozen
 * during the server round-trip) and confirm a destructive disconnect.
 *
 * The server actions are passed in as props (same pattern as
 * ImportHistorySection) and remain the form `action`, so the work still
 * runs server-side; `useFormStatus` only reads the in-flight state of
 * the enclosing form.
 */
import { useFormStatus } from "react-dom";

type FormAction = () => Promise<void>;
type ConnectAction = (formData?: FormData) => Promise<void>;

function SubmitButton({
  children,
  pendingLabel,
  primary = false,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`cp-btn ${primary ? "primary" : ""}`}
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function StravaConnectionActions({
  syncAction,
  disconnectAction,
}: {
  syncAction: FormAction;
  disconnectAction: FormAction;
}) {
  function confirmDisconnect(e: React.FormEvent<HTMLFormElement>) {
    if (
      !window.confirm(
        "Disconnect Strava? Your imported activities stay, but new ones won't sync until you reconnect — which means re-authorizing through Strava.",
      )
    ) {
      e.preventDefault();
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <form action={syncAction}>
        <SubmitButton primary pendingLabel="Syncing…">
          Sync now
        </SubmitButton>
      </form>
      <form action={disconnectAction} onSubmit={confirmDisconnect}>
        <SubmitButton pendingLabel="Disconnecting…">Disconnect</SubmitButton>
      </form>
    </div>
  );
}

export function StravaConnectButton({
  connectAction,
  disabled = false,
}: {
  connectAction: ConnectAction;
  disabled?: boolean;
}) {
  return (
    <form action={connectAction}>
      <SubmitButton primary pendingLabel="Connecting…" disabled={disabled}>
        Connect Strava
      </SubmitButton>
    </form>
  );
}
