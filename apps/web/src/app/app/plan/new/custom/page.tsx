import { redirect } from "next/navigation";

// The legacy custom archetype block builder has been retired. Block creation
// now flows exclusively through the program wizard (Hybrid is the build-your-own
// path). Kept as a redirect so old bookmarks / Cmd-K entries don't 404.
export default function CustomBlockPageRedirect(): never {
  redirect("/app/program");
}
