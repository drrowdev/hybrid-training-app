import { redirect } from "next/navigation";

// Legacy route — engine state now lives under Stats.
export default function FreshnessLegacy() {
  redirect("/app/stats/engine");
}
