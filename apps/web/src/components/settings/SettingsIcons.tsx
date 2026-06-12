/**
 * Settings hub line-icons — stroked 24×24 glyphs that replace the old emoji
 * tiles. Same visual language as the BottomTabBar icons (stroke: currentColor,
 * round caps) so the Settings grid reads as part of the tactical sage system
 * rather than a tray of OS emoji.
 */
import type { ReactNode } from "react";

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export type SettingsIconName =
  | "profile"
  | "bodyweight"
  | "equipment"
  | "training-maxes"
  | "bw-progression"
  | "limitations"
  | "events"
  | "preferences"
  | "integrations"
  | "hr-zones";

export function SettingsIcon({ name }: { name: SettingsIconName }): ReactNode {
  switch (name) {
    case "profile": // compass
      return (
        <svg {...base}>
          <circle cx="12" cy="12" r="9" />
          <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
        </svg>
      );
    case "bodyweight": // scale
      return (
        <svg {...base}>
          <path d="M3 7h18l-3 9a2 2 0 0 1-2 1.4H8A2 2 0 0 1 6 16L3 7z" />
          <path d="M12 7V4M9 4h6" />
        </svg>
      );
    case "equipment": // dumbbell
      return (
        <svg {...base}>
          <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" />
        </svg>
      );
    case "training-maxes": // gauge
      return (
        <svg {...base}>
          <path d="M4 18a8 8 0 1 1 16 0" />
          <path d="M12 18l4-5" />
        </svg>
      );
    case "bw-progression": // branching nodes
      return (
        <svg {...base}>
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="18" cy="14" r="2" />
          <path d="M8 17 16 7M8 18h4a2 2 0 0 0 2-2" />
        </svg>
      );
    case "limitations": // heart pulse
      return (
        <svg {...base}>
          <path d="M19 14c1.5-1.6 2-3 2-4.5A4.5 4.5 0 0 0 12 7a4.5 4.5 0 0 0-9 2.5C3 12 6 15 12 20c2.2-1.8 3.9-3.4 5-4.6z" />
          <path d="M3.5 12h3l1.5-3 2 6 1.5-3h3" />
        </svg>
      );
    case "events": // flag
      return (
        <svg {...base}>
          <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
        </svg>
      );
    case "preferences": // sliders
      return (
        <svg {...base}>
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
      );
    case "integrations": // plug
      return (
        <svg {...base}>
          <path d="M9 2v5M15 2v5M7 7h10v3a5 5 0 0 1-10 0V7zM12 15v5" />
        </svg>
      );
    case "hr-zones": // heart
      return (
        <svg {...base}>
          <path d="M19 14c1.5-1.6 2-3 2-4.5A4.5 4.5 0 0 0 12 7a4.5 4.5 0 0 0-9 2.5C3 12 6 15 12 20c2.2-1.8 3.9-3.4 5-4.6z" />
        </svg>
      );
  }
}
