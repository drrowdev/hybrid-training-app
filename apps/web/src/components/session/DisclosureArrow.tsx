/**
 * DisclosureArrow — a sized, currentColor SVG caret used to indicate
 * collapsed / expanded state on session-page disclosure controls.
 *
 * Replaces the inline unicode triangles (▸ / ▾) that were rendered at
 * body font-size and were barely visible. The SVG inherits its colour
 * from the surrounding text (`currentColor`) so the existing muted /
 * accent colour tokens carry through to both light and dark themes.
 *
 * Visual contract:
 *   - `open === false` → right-pointing caret (▸)
 *   - `open === true`  → down-pointing caret (▾)
 *
 * Rendered at 18px by default, tappable region inherited from the
 * surrounding button. The component is purely presentational and
 * always `aria-hidden` — collapsed/expanded state should be conveyed
 * to assistive tech via `aria-expanded` on the parent control.
 */
import type { CSSProperties } from "react";

export type DisclosureArrowProps = {
  open: boolean;
  /** Pixel size; default 18. */
  size?: number;
  /** Optional inline style override (e.g. opacity, margin). */
  style?: CSSProperties;
  /**
   * When true, skip the internal rotation transform so the parent can
   * control orientation via CSS (e.g. `details[open] > summary .arrow
   * { transform: rotate(90deg) }`). Useful inside a `<details>`
   * element where React doesn't own the open state.
   */
  externalRotation?: boolean;
};

export function DisclosureArrow({ open, size = 18, style, externalRotation = false }: DisclosureArrowProps) {
  return (
    <svg
      data-testid="disclosure-arrow"
      data-open={open ? "true" : "false"}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{
        display: "inline-block",
        flexShrink: 0,
        transition: "transform 120ms ease",
        // Default points down (▾) when externalRotation is true; the
        // parent CSS rotates the wrapper by -90deg in the closed state.
        transform: externalRotation ? undefined : (open ? "rotate(0deg)" : "rotate(-90deg)"),
        color: "currentColor",
        ...style,
      }}
    >
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
