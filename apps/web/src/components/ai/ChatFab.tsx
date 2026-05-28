"use client";

/**
 * ChatFab — fixed-position FAB anchored bottom-right, safe-area aware.
 * Always rendered (gating happens in the server-side `ChatMount`).
 */

export function ChatFab({
  onClick,
}: {
  onClick: () => void;
}): React.ReactElement {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        data-testid="ai-chat-fab"
        aria-label="Open AI chat"
        className="cp-ai-fab"
      >
        <span aria-hidden="true">✨</span>
      </button>
      <style jsx>{`
        .cp-ai-fab {
          position: fixed;
          right: max(16px, env(safe-area-inset-right));
          bottom: calc(80px + env(safe-area-inset-bottom));
          width: 56px;
          height: 56px;
          border-radius: 9999px;
          background: var(--cp-accent, #4f46e5);
          color: white;
          border: none;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
          font-size: 24px;
          cursor: pointer;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cp-ai-fab:hover {
          filter: brightness(1.05);
        }
        @media (min-width: 768px) {
          .cp-ai-fab {
            bottom: max(24px, env(safe-area-inset-bottom));
          }
        }
      `}</style>
    </>
  );
}
