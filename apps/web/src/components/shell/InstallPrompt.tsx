"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "cp-install-prompt-dismissed";
const SNOOZE_UNTIL_KEY = "cp-install-prompt-snooze-until";
const VISIT_KEY = "cp-visit-count";
const SNOOZE_DAYS = 14;

/** True when dismissal or snooze is currently active. */
function isSuppressed(): boolean {
  try {
    if (localStorage.getItem(DISMISS_KEY) === "1") return true;
    const snoozeUntil = Number(localStorage.getItem(SNOOZE_UNTIL_KEY) ?? "0");
    if (snoozeUntil > Date.now()) return true;
  } catch {
    // localStorage unavailable (private mode / cookies blocked) — fail safe by not showing.
    return true;
  }
  return false;
}

/**
 * Install nudge banner. Renders on the third visit, dismissible. Two flows:
 *  - Chrome/Android: hooks beforeinstallprompt for a native prompt
 *  - iOS Safari: shows a manual "share -> Add to Home Screen" instruction
 *    card (Safari doesn't fire beforeinstallprompt)
 *
 * Dismissal model:
 *  - "Not now" snoozes for 14 days
 *  - Successful install (`accepted` outcome) permanently dismisses
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iOS, setIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Hide if already installed.
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (isSuppressed()) return;

    // Bump visit counter (capped — we don't need huge values).
    const current = Number(localStorage.getItem(VISIT_KEY) ?? "0");
    const next = Math.min(current + 1, 999);
    localStorage.setItem(VISIT_KEY, String(next));
    const visitsOk = next >= 3;

    const ua = navigator.userAgent;
    const isIOSdevice = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);

    // Defer state updates so they don't run synchronously inside the effect.
    let cancelled = false;
    const queueShow = (val: boolean) => {
      if (cancelled) return;
      queueMicrotask(() => {
        if (cancelled) return;
        // Defensive re-check — dismissal may have happened in another tab.
        if (isSuppressed()) return;
        if (isIOSdevice) setIOS(true);
        setShow(val);
      });
    };

    if (isIOSdevice) {
      queueShow(visitsOk);
      return () => {
        cancelled = true;
      };
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const ev = e as BeforeInstallPromptEvent;
      queueMicrotask(() => {
        if (cancelled) return;
        // Crucial: re-check suppression INSIDE the listener. Chrome can fire
        // beforeinstallprompt repeatedly across navigations; once the user
        // dismissed we must not re-show until the snooze expires.
        if (isSuppressed()) return;
        setDeferred(ev);
        if (visitsOk) setShow(true);
      });
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  const dismiss = () => {
    try {
      const until = Date.now() + SNOOZE_DAYS * 86_400_000;
      localStorage.setItem(SNOOZE_UNTIL_KEY, String(until));
    } catch {
      // localStorage unavailable — at least hide for this session.
    }
    setShow(false);
    setDeferred(null);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      try {
        localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        // ignore
      }
    } else {
      // User dismissed the native prompt — treat as a "not now" snooze.
      try {
        const until = Date.now() + SNOOZE_DAYS * 86_400_000;
        localStorage.setItem(SNOOZE_UNTIL_KEY, String(until));
      } catch {
        // ignore
      }
    }
    setShow(false);
    setDeferred(null);
  };

  if (!show) return null;

  return (
    <div
      role="region"
      aria-label="Install Hybrid"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 40,
        padding: 14,
        borderRadius: 14,
        background: "var(--cp-bg-elevated)",
        border: "1px solid var(--cp-border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        display: "grid",
        gap: 10,
        maxWidth: 480,
        marginInline: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">⚡</div>
        <div style={{ display: "grid", gap: 4, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Install Hybrid for faster gym access</div>
          {iOS ? (
            <div style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
              Tap the <strong>Share</strong> icon in Safari, then{" "}
              <strong>Add to Home Screen</strong>. Logs offline, opens like a real app.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
              One tap to put Hybrid on your home screen. Opens full-screen, no browser
              chrome.
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={dismiss} className="cp-btn ghost" style={{ fontSize: 12 }}>
          Not now
        </button>
        {!iOS && (
          <button type="button" onClick={install} className="cp-btn primary" style={{ fontSize: 13 }}>
            Install
          </button>
        )}
      </div>
    </div>
  );
}
