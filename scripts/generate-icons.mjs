import sharp from "sharp";
import { writeFile, readFile } from "node:fs/promises";

// Home-screen / PWA icon generator.
//
// Brand: S×C. Near-black master tile (#0F1310, the app background) with the
// S×C wordmark (light S/C #F4F3F1, sage × #8FB39B). We deliberately
// do NOT use a sage tile — the sage × loses contrast on a sage field.
//
// The wordmark is composited from the canonical brand asset so the icon can
// never drift from the wordmark used elsewhere (header, splash screens).

const sizes = [192, 256, 384, 512];

const ICON_BG = "#0f1310";

const wordmarkPath = new URL(
  "../apps/web/public/branding/sxc-wordmark-dark.svg",
  import.meta.url,
);
const outDir = new URL("../apps/web/public/icons/", import.meta.url);
const wordmark = await readFile(wordmarkPath);

// Charcoal background tile. `rx` rounds the corners for the standard
// home-screen icon; pass rx=0 for full-bleed (maskable + apple-touch, where
// the OS supplies its own mask).
const bgSvg = (size, rx) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rx}" ry="${rx}" fill="${ICON_BG}"/>
</svg>`;

/**
 * Render a charcoal tile with the S×C wordmark centred.
 * @param size      output pixel size
 * @param rx        corner radius (0 = full bleed)
 * @param widthFrac wordmark width as a fraction of the tile (smaller for
 *                  maskable so the glyph stays inside the 80% safe zone)
 */
async function tile(size, rx, widthFrac) {
  const bg = await sharp(Buffer.from(bgSvg(size, rx))).png().toBuffer();
  const logoW = Math.round(size * widthFrac);
  const logo = await sharp(wordmark, { density: 512 })
    .resize({ width: logoW })
    .png()
    .toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const logoH = logoMeta.height ?? 0;
  return sharp(bg)
    .composite([
      {
        input: logo,
        top: Math.round((size - logoH) / 2),
        left: Math.round((size - logoW) / 2),
      },
    ])
    .png()
    .toBuffer();
}

async function emit(name, buffer) {
  await writeFile(new URL(name, outDir), buffer);
  console.log(`wrote ${name} (${buffer.length} bytes)`);
}

for (const size of sizes) {
  // Standard rounded-square icon. iOS re-masks on top; Android may round too.
  await emit(`icon-${size}.png`, await tile(size, Math.round(size * 0.22), 0.66));
}

// Maskable: full-bleed background, wordmark kept inside the inner 80% safe
// zone so Android adaptive-icon masks never clip the glyph.
await emit("icon-maskable-512.png", await tile(512, 0, 0.56));

// Apple touch icon: full-bleed square (iOS rounds it itself), 180×180.
await emit("apple-touch-icon.png", await tile(180, 0, 0.66));
