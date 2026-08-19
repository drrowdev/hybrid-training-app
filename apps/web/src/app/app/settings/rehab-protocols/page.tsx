/**
 * Settings → Rehab protocols.
 *
 * The library the wizard picks from. Authoring lives here rather than inside
 * the program wizard so a protocol survives the program it was written for.
 */
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadPickerCatalog } from "@/lib/planner/picker-catalog";
import { listRehabProtocols } from "@/lib/rehab-protocols/queries";
import {
  createRehabProtocol,
  deleteRehabProtocol,
  duplicateRehabProtocol,
  updateRehabProtocol,
} from "@/lib/rehab-protocols/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  RehabProtocolsClient,
  type PickerMovement,
} from "@/components/rehab-protocols/RehabProtocolsClient";

export default async function RehabProtocolsPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [protocols, catalog] = await Promise.all([
    listRehabProtocols(),
    loadPickerCatalog(supabase),
  ]);

  // Cardio has no place in a rehab protocol — the same filter the wizard's
  // rehab movement list has always applied.
  const movements: PickerMovement[] = catalog
    .filter((movement) => movement.pattern !== "cardio")
    .map((movement) => ({
      id: movement.id,
      name: movement.displayName,
      pattern: movement.pattern ?? "other",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 20 }}>
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Rehab protocols"
      />
      <RehabProtocolsClient
        protocols={protocols}
        movements={movements}
        createAction={createRehabProtocol}
        updateAction={updateRehabProtocol}
        duplicateAction={duplicateRehabProtocol}
        deleteAction={deleteRehabProtocol}
      />
    </div>
  );
}
