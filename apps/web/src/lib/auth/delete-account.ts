"use server";

import { redirect } from "next/navigation";
import { createAdmin, createClient } from "@/lib/supabase/server";

/**
 * Hard-delete the signed-in user. GDPR Article 17 implementation.
 *
 * Sequence:
 *   1. Verify the caller is authenticated.
 *   2. Call admin API to delete the auth.users row.
 *   3. The FK chain (profiles, limitations, movements, sessions, …) cascades.
 *   4. Sign the user out; redirect to the marketing root.
 */
export async function deleteAccount(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const admin = createAdmin();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw new Error(error.message);

  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
