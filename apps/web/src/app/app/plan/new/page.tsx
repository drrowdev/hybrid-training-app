import { redirect } from "next/navigation";

// The wizard now lives inline on /app/plan when no active block exists,
// so the previous /app/plan/new intermediate page is collapsed away.
// This redirect keeps any saved bookmarks, Cmd-K entries, or old
// internal links from 404'ing.
export default function NewBlockPageRedirect(): never {
  redirect("/app/plan");
}
