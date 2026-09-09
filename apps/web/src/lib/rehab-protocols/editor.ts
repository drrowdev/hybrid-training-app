import { parseRehabReps } from "@hta/domain";
import type { SessionLink } from "@/lib/platform/session-links";
import type { RehabProtocolItem } from "./item-schema";
import { parseRehabProtocolInput } from "./schema";

export type RehabProtocolDraftItem = Omit<RehabProtocolItem, "reps" | "repRange"> & {
  reps: string;
};

export function parseRehabProtocolDraft(draft: {
  name: string;
  items: readonly RehabProtocolDraftItem[];
  links: SessionLink[];
}): ReturnType<typeof parseRehabProtocolInput> {
  const items: RehabProtocolItem[] = [];
  for (const [index, { reps, ...item }] of draft.items.entries()) {
    const parsed = parseRehabReps(reps);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `${item.movementName} (movement ${index + 1}): ${parsed.error}`,
      };
    }
    items.push({ ...item, ...parsed.value });
  }
  return parseRehabProtocolInput({
    name: draft.name,
    definition: { items, links: draft.links },
  });
}
