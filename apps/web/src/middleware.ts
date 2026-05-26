import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every path EXCEPT:
     *   _next/static (build assets)
     *   _next/image  (image optimisation)
     *   favicon.ico, robots.txt, sitemap.xml, manifest.webmanifest, sw.js — static metadata files
     *   api/health — internal liveness probe; runs no auth-aware code
     *   *.svg, *.png, *.jpg, *.jpeg, *.gif, *.webp — bare image assets
     *
     * Each excluded path skips the Supabase token-refresh call in
     * `updateSession`, saving a few ms per request (audit F18).
     * The negative-lookahead anchors at `/`, so adding e.g. `manifest.webmanifest`
     * here does NOT exclude `/api/manifest.webmanifest` (or any other
     * deeper path) — only the literal top-level file. Likewise
     * `api/health` matches `/api/health` exactly, NOT `/api/*`.
     *
     * The auth-callback route still goes through.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|sw\\.js|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
