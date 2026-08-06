import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { BrandMark } from "@/components/brand/BrandMark";

export default async function Home() {
  // The Capacitor shell launches at "/". If a session is already live,
  // skip the landing/sign-in screen and go straight to Today.
  const {
    data: { user },
  } = await getAuthUser();
  if (user) redirect("/app");

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
      <div
        style={{
          display: "grid",
          gap: 32,
          justifyItems: "center",
          textAlign: "center",
        }}
      >
        <div role="img" aria-label="SxC">
          <BrandMark size={96} />
        </div>

        <Link
          href="/login"
          className="cp-btn primary big"
          style={{ minWidth: 200, justifyContent: "center" }}
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
