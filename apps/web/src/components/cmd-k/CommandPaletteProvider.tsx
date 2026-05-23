"use client";

/**
 * Owns open/close state for the quick-jump palette and binds the
 * global Cmd-K / Ctrl-K keyboard listener. Wraps children unchanged
 * so it can be slotted into `app/layout.tsx` without touching the
 * existing `AppShell` layout.
 */

import { useCallback, useEffect, useState } from "react";
import { CommandPalette } from "./CommandPalette";
import type { PaletteIndices } from "@/lib/cmd-k/types";

export function CommandPaletteProvider({
  indices,
  children,
}: {
  indices: PaletteIndices;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd-K (Mac) / Ctrl-K (Win/Linux). Match either modifier so
      // power users on either OS get the same trigger. Ignore when
      // the user already has the dialog open + is typing — the
      // dialog handles its own Esc binding.
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <>
      {children}
      <CommandPalette open={open} onClose={close} indices={indices} />
    </>
  );
}
