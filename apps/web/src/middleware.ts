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
     *   favicon.ico, *.svg, *.png, *.jpg, *.jpeg, *.gif, *.webp
     *   any path explicitly used by Next internals
     * The auth-callback route + the API health check still go through.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
