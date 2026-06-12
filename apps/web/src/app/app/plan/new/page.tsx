import { redirect } from "next/navigation";

// Block creation now flows through the program wizard at /app/program.
// This legacy route is kept as a redirect so saved bookmarks, Cmd-K entries,
// or old internal links don't 404.
export default function NewBlockPageRedirect(): never {
  redirect("/app/program");
}
