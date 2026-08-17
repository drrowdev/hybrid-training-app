"use client";

/**
 * Wraps a completed HYROX session's read-only summary with an "Edit workout"
 * affordance. Tapping it swaps the summary for the prefilled `HyroxCompletionForm`
 * in edit mode; saving re-materializes the logged loads / time / effort (the
 * complete action is idempotent), and Cancel returns to the summary.
 */
import { useState } from "react";
import {
  HyroxCompletionForm,
  type HyroxCompletionFormProps,
} from "./HyroxCompletionForm";

export function CompletedHyroxEditor({
  formProps,
  children,
}: {
  formProps: Omit<HyroxCompletionFormProps, "editMode" | "onCancel">;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <HyroxCompletionForm
        {...formProps}
        editMode
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {children}
      <button
        type="button"
        className="cp-btn"
        data-testid="hyrox-edit-workout"
        onClick={() => setEditing(true)}
        style={{ justifySelf: "start", minHeight: 44 }}
      >
        ✎ Edit workout
      </button>
    </div>
  );
}
