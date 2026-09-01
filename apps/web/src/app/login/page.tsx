import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { safeAppRedirectPath } from "@/lib/auth/redirect-path";
import { LoginForm } from "./login-form";
import { BrandMark } from "@/components/brand/BrandMark";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: requestedNext, error } = await searchParams;
  const next = safeAppRedirectPath(requestedNext);

  // Already signed in (e.g. the native shell relaunching with a live
  // session): skip the form and land straight on the destination. Guard
  // against open redirects with the same guard used by every auth completion.
  const {
    data: { user },
  } = await getAuthUser();
  if (user) redirect(next);

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
              display: "inline-flex",
            }}
          >
            <BrandMark size={60} />
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
