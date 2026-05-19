import Link from "next/link";
import { CheckInForm } from "@/components/check-in-form";
import { startSession } from "@/lib/sessions/actions";

export default function NewSessionPage() {
  return (
    <main className="min-h-screen px-6 py-12 max-w-md mx-auto space-y-6">
      <header className="space-y-1">
        <Link
          href="/app"
          className="text-xs text-foreground/50 hover:text-foreground"
        >
          ← back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Start session
        </h1>
        <p className="text-sm text-foreground/60">
          2-slider check-in, then log what you actually did.
        </p>
      </header>
      <CheckInForm action={startSession} />
    </main>
  );
}
