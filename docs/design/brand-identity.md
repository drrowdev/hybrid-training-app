# Brand identity — SxC

**Status:** locked (2026-06-01). Living document; update if the visual system changes.

The app's public brand is **SxC** — short for **Strength × Cardio**. Spoken aloud as
"S-C". The `×` is a multiplier glyph (strength *times* cardio), not the letter "x",
and is the signature element of the mark.

> The product/package name remains `Hybrid Training` internally (`@hta/web`,
> manifest `name`). SxC is the consumer-facing brand and domain. Don't rename
> packages or routes to match.

## Domain

Production domain: **getsxc.app** (registered via Vercel — auto DNS + SSL, free
WHOIS privacy). `metadataBase` in `apps/web/src/app/layout.tsx` points here.

## Wordmark

`S×C` — the lockup.

| Part | Spec |
|---|---|
| `S` and `C` | **Archivo Bold (700)**, `letter-spacing: -0.02em` |
| `×` | same face/weight, **accent green**, ~1px optical side margin |

In the app header the wordmark is rendered as **live text** (not an image) so it
adapts to the active theme: `S`/`C` use `var(--cp-text)`, `×` uses
`var(--cp-accent)`. The Archivo face is loaded via `next/font/google` in
`layout.tsx` and exposed as `--font-brand`.

## Descriptor

`STRENGTH × CARDIO` — sits centered beneath the wordmark in the full lockup.

| Spec | Value |
|---|---|
| Face | **JetBrains Mono**, weight 500 |
| Case | uppercase |
| Tracking | `letter-spacing: 0.28em` (wide tracked) |
| `×` | accent green, weight 700 |
| Ink | `#BDBCB6` on dark · `#57564F` on light |

## Palette

| Token | Light | Dark | Role |
|---|---|---|---|
| Iron | `#1A1A1A` | `#F4F3F1` | bg / ink (inverts by mode) |
| Accent green | `#65A30D` | `#A3E635` | the `×` glyph + UI accent |
| Descriptor ink | `#57564F` | `#BDBCB6` | descriptor text |

These map to the existing CSS variables in `globals.css`: `--cp-accent`
(`#65a30d` light / `#a3e635` dark) and `--cp-text`. The manifest
`theme_color` (`#a3e635`) and `background_color` (`#1a1a1a`) are already on-palette.

## Type system

| Face | Use | Loaded as |
|---|---|---|
| **Archivo** (700) | wordmark only | `--font-brand` |
| **JetBrains Mono** | descriptor + numeric / stat UI | `--font-mono` |
| **Geist / Geist Mono** | body UI (current app default) | `--font-sans` / `--font-mono` |

> Note: body UI currently uses Geist. JetBrains Mono is the brand's stat/number
> face per the spec; adopt it for numeric UI where it improves legibility, but
> that migration is out of scope for the brand drop.

## App icon

Primary master is **charcoal**: iron-dark `#1A1A1A` tile, off-white `S`/`C`, green
`×`, full-bleed square (the OS applies its own corner mask). Wordmark content sits
at ~58% tile width — inside the maskable safe zone.

**Do not** use a green-background tile: on green the `×` loses contrast and the
signature green `×` disappears. Charcoal preserves it.

Sizes shipped in `apps/web/public/icons/`: `icon-{192,256,384,512}.png`,
`icon-maskable-512.png`, `apple-touch-icon.png` (180). Favicon (multi-res 16–256)
at `apps/web/src/app/favicon.ico`. Alternate directions (green tile, outlined) exist
as SVG source but are not the shipped default.

## Assets in the repo

| Path | What |
|---|---|
| `public/branding/sxc-lockup-{dark,light}.svg` | wordmark + descriptor, transparent |
| `public/branding/sxc-lockup-{dark,light}-bg.svg` | same, with iron tile baked in |
| `public/branding/sxc-wordmark-{dark,light}.svg` | `S×C` only |
| `public/og-image.png` | 1200×630 OpenGraph/Twitter share card |
| `public/icons/*`, `src/app/favicon.ico` | app icon set + favicon |

All SVGs have their **text outlined to vector paths** — they render identically
anywhere with no font loading. Choose `-dark` on dark surfaces, `-light` on light;
use `-bg` variants only when a baked-in tile is needed (e.g. social/OG). Prefer
`wordmark` where space is tight, `lockup` where the descriptor should read.

## OpenGraph / social

`og-image.png` (1200×630): flat iron `#1A1A1A` background, centered dark lockup,
a short green accent rule. Wired in `layout.tsx` via `metadata.openGraph` +
`metadata.twitter` (`summary_large_image`).

## Usage rules

- The `×` is **always** the accent green and **always** a multiplier glyph — never
  recolor it to match S/C, never substitute a literal lowercase "x".
- Header brand stays **live text** (theme-adaptive), not a fixed-color `<img>`.
- App icon stays **charcoal**, never green-tile (contrast rule above).
- Public artifacts (this repo, store metadata, marketing) carry **no PII** — brand
  handle only, no real name/location.
