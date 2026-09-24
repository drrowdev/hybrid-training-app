"use client";

import { useRef, useState, useTransition } from "react";
import { previewTrainingRestore, type PlannedMovePreview } from "@/lib/planner/actions";
import type { ScheduleReview } from "@/lib/schedule/storage";

export function ScheduleRestoreButton({ kind, id, label, testId, onRestore }: {
  kind: "block" | "workout";
  id: string;
  label: string;
  testId: string;
  onRestore: (review: ScheduleReview) => Promise<void>;
}) {
  const [preview, setPreview] = useState<PlannedMovePreview | null>(null);
  const [acceptOverlap, setAcceptOverlap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  function restore() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const review = preview ?? await previewTrainingRestore({ kind, id });
        if (!preview) {
          setPreview(review);
          setAcceptOverlap(false);
          if (review.overlaps.length) return;
        }
        await onRestore({ revision: review.revision, requestId: review.requestId, acceptOverlap });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not restore this item. Try again.");
      } finally { busy.current = false; }
    });
  }
  return <div style={{ display: "grid", gap: 8, minWidth: 0, maxWidth: "100%" }}>
    <button type="button" className="cp-btn ghost" data-testid={testId} onClick={restore}
      disabled={pending || (!!preview?.overlaps.length && !acceptOverlap)}>{label}</button>
    {!!preview?.overlaps.length && <>
      <ul style={{ margin: 0, paddingLeft: 20, overflowWrap: "anywhere" }}>{preview.overlaps.map((entry) =>
        <li key={`${entry.source}:${entry.id}`}>{entry.date} · {entry.title}</li>)}</ul>
      <label style={{ display: "flex", gap: 8, alignItems: "start" }}>
        <input type="checkbox" checked={acceptOverlap} disabled={pending}
          onChange={(event) => setAcceptOverlap(event.target.checked)} />
        Keep both workouts on these dates
      </label>
    </>}
    {error && <p role="alert" style={{ margin: 0, color: "var(--cp-danger)" }}>{error}</p>}
    {error && preview && <button type="button" className="cp-btn ghost" disabled={pending}
      onClick={() => { setPreview(null); setAcceptOverlap(false); setError(null); }}>Review again</button>}
  </div>;
}
