/**
 * Phase 3 C1/C2 — feedback primitives.
 *
 * Both are best-effort and gated on (a) browser support and (b) the
 * user's preference (passed in from the server). Importing this
 * module is safe on the server — every helper guards on `typeof
 * window` and silently no-ops in non-DOM contexts.
 */

/** Capacitor `ImpactStyle` serialized values (we call the plugin over the
 * injected native bridge rather than importing `@capacitor/haptics`, so the
 * web bundle stays free of native deps under remote-load). */
type ImpactStyle = "HEAVY" | "MEDIUM" | "LIGHT";

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: {
    Haptics?: {
      impact?: (opts: { style: ImpactStyle }) => unknown;
    };
  };
}

/**
 * Fire a native Taptic-Engine impact when running inside the Capacitor shell.
 * Returns true if a native haptic was dispatched. iOS Safari never implements
 * the Web Vibration API, so on iPhone this is the ONLY path that produces a
 * real buzz; on plain web (no native bridge) it returns false and the caller
 * falls back to `navigator.vibrate` (which works on Android, no-ops on iOS).
 */
function nativeHaptic(ms: number): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  if (!cap?.isNativePlatform?.()) return false;
  const impact = cap.Plugins?.Haptics?.impact;
  if (typeof impact !== "function") return false;
  // Map the legacy vibration duration onto an impact weight: the rest-timer
  // cue (~120ms) wants a firm thud; a set-logged tick (~10ms) a light tap.
  const style: ImpactStyle = ms >= 100 ? "HEAVY" : ms >= 20 ? "MEDIUM" : "LIGHT";
  try {
    void Promise.resolve(impact({ style })).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Short haptic tick. Prefers the native Taptic Engine inside the Capacitor
 * shell, falling back to the Web Vibration API. Default duration ~10ms.
 */
export function hapticTick(enabled: boolean, ms = 10): void {
  if (!enabled) return;
  if (nativeHaptic(ms)) return;
  if (typeof navigator === "undefined") return;
  try {
    const nav = navigator as Navigator & {
      vibrate?: (p: number | number[]) => boolean;
    };
    nav.vibrate?.(ms);
  } catch {
    // No-op — best-effort.
  }
}

/**
 * Short ~200ms beep at 600Hz via Web Audio. Returns true if the tone
 * was scheduled. Browser autoplay rules require a prior user gesture;
 * the AudioContext silently stays suspended otherwise.
 */
export function timerBeep(enabled: boolean): boolean {
  if (!enabled) return false;
  if (typeof window === "undefined") return false;

  type AudioCtor = typeof AudioContext;
  const Ctor: AudioCtor | undefined =
    (window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor })
      .AudioContext ??
    (window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor })
      .webkitAudioContext;
  if (!Ctor) return false;

  try {
    const ctx = new Ctor();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 600;

    const now = ctx.currentTime;
    const dur = 0.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.setValueAtTime(0.18, now + dur - 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);

    setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, Math.ceil(dur * 1000) + 200);
    return true;
  } catch {
    return false;
  }
}
