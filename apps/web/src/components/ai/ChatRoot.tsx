"use client";

/**
 * ChatRoot — client island that owns the open/closed state for the
 * chat surface. Renders the FAB and (when open) the ChatPanel.
 *
 * Split from ChatMount so the server-side access check stays out of
 * the client bundle.
 */
import { useState } from "react";

import { ChatFab } from "./ChatFab";
import { ChatPanel } from "./ChatPanel";

export function ChatRoot(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ChatFab onClick={() => setOpen(true)} />
      {open ? <ChatPanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}
