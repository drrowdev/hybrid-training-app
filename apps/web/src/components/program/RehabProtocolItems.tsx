import { formatRehabReps } from "@hta/domain";
import type { RehabProtocolItem } from "@/lib/rehab-protocols/item-schema";
import { doseLabel } from "./session-slot-editing";
import styles from "./ProgramPicker.module.css";

const SIDE_LABEL = { both: "Both sides", left: "Left", right: "Right" } as const;

export function RehabProtocolItems({ items }: { items: readonly RehabProtocolItem[] }) {
  return (
    <ul className={styles.rehabSessionItems}>
      {items.map((item, index) => {
        const quantity = [
          formatRehabReps(item),
          item.holdSeconds != null ? `${item.holdSeconds}s hold` : null,
        ].filter(Boolean).join(" + ");
        const dose = doseLabel({
          sets: String(item.sets),
          reps: quantity,
          load: item.targetWeightKg != null ? `${item.targetWeightKg} kg` : null,
        });
        return (
          <li key={`${item.movementId}-${index}`}>
            <span className={styles.rehabItemName}>{item.movementName}</span>
            <span className={styles.rehabItemDose}>
              {[dose, item.side ? SIDE_LABEL[item.side] : null].filter(Boolean).join(" · ")}
            </span>
            {item.instructions ? (
              <span className={styles.rehabItemNote}>{item.instructions}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
