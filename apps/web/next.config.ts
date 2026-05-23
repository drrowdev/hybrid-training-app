import type { NextConfig } from "next";

// Build SHA plumbing for the top-bar status cluster. Prefer the
// auto-provided Vercel commit SHA, fall back to a manual GIT_SHA env,
// otherwise mark the build as a local "dev" build. Exposed via
// NEXT_PUBLIC_ so client components can read it at runtime.
const buildSha =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GIT_SHA ??
  "dev";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha,
  },
};

export default nextConfig;
