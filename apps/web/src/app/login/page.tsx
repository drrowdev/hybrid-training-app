import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/app", error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--cp-bg)",
        color: "var(--cp-text)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }} className="space-y-8">
        <header className="space-y-2" style={{ textAlign: "center" }}>
          <Link
            href="/"
            aria-label="SxC — home"
            style={{
              textDecoration: "none",
              color: "var(--cp-text)",
              fontFamily: "var(--font-brand), system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 48,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              display: "inline-block",
            }}
          >
            S<span style={{ color: "var(--cp-accent)", margin: "0 2px" }}>×</span>
            C
          </Link>
          <p className="text-sm" style={{ color: "var(--cp-text-muted)" }}>
            Sign in to continue
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
