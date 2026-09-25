import type { Prescription } from "@hta/db";

export const STALE_PRESCRIPTION_MESSAGE = "This workout changed in another tab. Your changes have not been saved. Review the current workout, then reapply your changes.";

export function prescriptionRevision(prescription: Prescription | null | undefined): string {
  return prescription?.meta?.editRevision ?? "0";
}
