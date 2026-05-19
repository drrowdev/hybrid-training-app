import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/app", error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Hybrid Training App
          </h1>
          <p className="text-sm text-foreground/60">
            Sign in to log sessions, run programs, and see your engine state.
          </p>
        </header>
        {error && (
          <p className="text-sm text-red-600">{decodeURIComponent(error)}</p>
        )}
        <Suspense>
          <LoginForm next={next} />
        </Suspense>
      </div>
    </main>
  );
}
