"use client";

/**
 * Owns open/close state for the quick-jump palette and binds the
 * global Cmd-K / Ctrl-K keyboard listener. Wraps children unchanged
 * so it can be slotted into `app/layout.tsx` without touching the
 * existing `AppShell` layout.
 *
 * Also exposes an `open()` / `toggle()` API via React context so the
 * top-bar ⌘K hint chip (and any other UI surface) can trigger the
 * palette without re-binding the keyboard listener.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CommandPalette } from "./CommandPalette";
import type { PaletteIndices } from "@/lib/cmd-k/types";

type CommandPaletteApi = {
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const CommandPaletteContext = createContext<CommandPaletteApi | null>(null);

export function useCommandPalette(): CommandPaletteApi {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error(
      "useCommandPalette must be used inside <CommandPaletteProvider>",
    );
  }
  return ctx;
}

export function CommandPaletteProvider({
  indices,
  children,
}: {
  indices: PaletteIndices;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

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

  const api = useMemo<CommandPaletteApi>(
    () => ({ open, close, toggle }),
    [open, close, toggle],
  );

  return (
    <CommandPaletteContext.Provider value={api}>
      {children}
      <CommandPalette open={isOpen} onClose={close} indices={indices} />
    </CommandPaletteContext.Provider>
  );
}
