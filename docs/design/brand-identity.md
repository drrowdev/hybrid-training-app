# Brand identity — S×C

**Status:** updated 2026-06-16 (sage accent + descriptor dropped). Living
document; update if the visual system changes.

The app's public brand is **S×C**. Spoken aloud as "S-C". The `×` is a
multiplier glyph (strength *times* cardio), not the letter "x", and is the
signature element of the mark. The app is named **S×C** — there is no
"Strength × Cardio" descriptor in shipped copy or assets.

> The product/package name remains `Hybrid Training` internally (`@hta/web`).
> S×C is the consumer-facing brand and domain. Don't rename packages or routes
> to match.

## Domain

Production domain: **getsxc.app** (registered via Vercel — auto DNS + SSL, free
WHOIS privacy). `metadataBase` in `apps/web/src/app/layout.tsx` points here.

## Wordmark

`S×C` — the full mark.

| Part | Spec |
|---|---|
| `S` and `C` | **Archivo Bold (700)**, `letter-spacing: -0.02em` |
| `×` | same face/weight, **sage accent**, ~1px optical side margin |

In the app header the wordmark is rendered as **live text** (not an image) so it
adapts to the active theme: `S`/`C` use `var(--cp-text)`, `×` uses
`var(--cp-accent)`. The Archivo face is loaded via `next/font/google` in
`layout.tsx` and exposed as `--font-brand`.

The app ships a **dark-only sage theme** (`data-theme="dark"`); there is no
shipped light mode. Light-variant brand SVGs remain in the repo as source but
are not consumed by the app.

## Palette

| Token | Value | Role |
|---|---|---|
| Background | `#0f1310` | app background (`--cp-bg`) |
| Ink | `#e6ebe2` | primary text (`--cp-text`) |
| Sage accent | `#8fb39b` | the `×` glyph + UI accent (`--cp-accent`) |

These map to the CSS variables in `globals.css`: `--cp-accent` (`#8fb39b`),
`--cp-bg` (`#0f1310`), `--cp-text`. The manifest `theme_color` (`#8fb39b`) and
`background_color` (`#0f1310`) are on-palette.

> Historical: the original brand drop used a lime accent (`#A3E635` dark /
> `#65A30D` light) on an iron `#1A1A1A` background. The app moved to the sage
> theme app-wide; lime is retired.

## Type system

| Face | Use | Loaded as |
|---|---|---|
| **Archivo** (700) | wordmark only | `--font-brand` |
| **Oswald** | display headings | `--cp-font-display` |
| **JetBrains Mono** | nav tabs + numeric / stat UI | `--cp-font-mono` |
| **Geist / Geist Mono** | body UI (app default) | `--cp-font-sans` / `--font-mono` |

## App icon

Master tile is **near-black** `#0F1310` (the app background), with off-white
`S`/`C` and a sage `×`, full-bleed square (the OS applies its own corner mask).
Wordmark content sits inside the maskable safe zone.

**Do not** use a sage-background tile: on sage the `×` loses contrast and the
signature glyph disappears. The near-black tile preserves it.

Sizes shipped in `apps/web/public/icons/`: `icon-{192,256,384,512}.png`,
`icon-maskable-512.png`, `apple-touch-icon.png` (180). Favicon (multi-res 16–48,
PNG-in-ICO) at `apps/web/src/app/favicon.ico`. All are baked from the canonical
`sxc-wordmark-dark.svg` by `scripts/generate-icons.mjs`.

## Assets in the repo

| Path | What |
|---|---|
| `public/branding/sxc-wordmark-{dark,light}.svg` | `S×C` mark, transparent |
| `public/branding/sxc-lockup-{dark,light}.svg` | `S×C` mark, transparent (descriptor removed) |
| `public/branding/sxc-lockup-{dark,light}-bg.svg` | same, with tile baked in |
| `public/og-image.png` | 1200×630 OpenGraph/Twitter share card |
| `public/splash/*` | iOS PWA splash screens (baked from the wordmark) |
| `public/icons/*`, `src/app/favicon.ico` | app icon set + favicon |

All SVGs have their **text outlined to vector paths** — they render identically
anywhere with no font loading. The `-dark` variants are the shipped assets.

## Regenerating baked assets

The PNG icons, splash screens, OG card, and favicon are baked from the brand
SVGs. After changing a brand SVG or palette value:

- `node scripts/generate-icons.mjs` — app icons + apple-touch.
- `node scripts/generate-splash.mjs` — iOS splash set + `splash-screens.ts`.
- OG card + favicon are baked from `sxc-wordmark-dark.svg` on a `#0f1310` tile.

Installed home-screen icons/splash only refresh on reinstall.

## OpenGraph / social

`og-image.png` (1200×630): flat `#1A1A1A` background, centered `S×C` wordmark
(off-white `S`/`C`, sage `×`), a short sage accent rule. Wired in `layout.tsx`
via `metadata.openGraph` + `metadata.twitter` (`summary_large_image`).

## Usage rules

- The `×` is **always** the sage accent and **always** a multiplier glyph — never
  recolor it to match S/C, never substitute a literal lowercase "x".
- Header brand stays **live text** (theme-adaptive), not a fixed-color `<img>`.
- App icon stays **near-black**, never sage-tile (contrast rule above).
- No "Strength × Cardio" descriptor in shipped copy or assets — the brand is
  **S×C** only.
- Public artifacts (this repo, store metadata, marketing) carry **no PII** — brand
  handle only, no real name/location.
