"use client";

import { useState } from "react";
import { nextConfirmedView, nextEditMode, type SwimWorkoutView } from "@/lib/swim/view-types";
import { WorkoutClient } from "./WorkoutClient";

export function WorkoutScreen({ workout: incomingWorkout, userId, edit = false }: {
  workout: SwimWorkoutView; userId: string; edit?: boolean;
}) {
  const [heldWorkout, setWorkout] = useState(incomingWorkout);
  const effective = nextConfirmedView(heldWorkout, incomingWorkout, "props");
  if (effective !== heldWorkout) setWorkout(effective);
  const [warning, setWarning] = useState<string | null>(null);
  const [editIntent, setEditIntent] = useState<number | null>(null);
  const mode = nextEditMode(editIntent, edit, effective.revision);
  if (mode.intent !== editIntent) setEditIntent(mode.intent);

  return <WorkoutClient key={`${effective.id}:${effective.revision}`} workout={effective} userId={userId} edit={mode.open}
    onConfirmed={(view) => setWorkout((current) => nextConfirmedView(current, view, "confirmed"))}
    warning={warning} setWarning={setWarning} />;
}
