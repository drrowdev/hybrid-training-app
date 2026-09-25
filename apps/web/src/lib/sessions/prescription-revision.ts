import type { Prescription } from "@hta/db";

export const STALE_PRESCRIPTION_MESSAGE = "This workout changed in another tab. Your changes have not been saved. Review the current workout, then reapply your changes.";

export function prescriptionRevision(prescription: Prescription | null | undefined): string {
  return prescription?.meta?.editRevision ?? "0";
}

export function loadedPrescriptionConflict(prescription: Prescription, expectedRevision: FormDataEntryValue | null) {
  if (expectedRevision === null || expectedRevision === prescriptionRevision(prescription)) return null;
  return { error: STALE_PRESCRIPTION_MESSAGE, currentPrescription: prescription };
}
