import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md space-y-6 text-center">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Hybrid Training App
          </h1>
          <p className="text-sm text-foreground/60">
            Adaptive hybrid programming engine. Phase 0 — foundation only.
          </p>
        </header>
        <nav className="flex justify-center gap-3">
          <Link
            href="/login"
            className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Sign in
          </Link>
          <Link
            href="/api/health"
            className="rounded-md border border-foreground/20 px-4 py-2 text-sm hover:bg-foreground/5"
          >
            Health check
          </Link>
        </nav>
      </div>
    </main>
  );
}
