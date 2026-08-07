import sharp from "sharp";
import { writeFile, readFile } from "node:fs/promises";

// Home-screen / PWA icon generator.
//
// Brand: S×C. Near-black master tile (#0F1310, the app background) with the
// compact diamond mark (light S/C #F4F3F1, sage × #8FB39B). We deliberately
// do NOT use a sage tile — the sage × loses contrast on a sage field.
//
// The mark is composited from the canonical brand asset so the icon can
// never drift from the mark used elsewhere (header, splash screens).

const sizes = [192, 256, 384, 512];

const ICON_BG = "#0f1310";

const markPath = new URL(
  "../apps/web/public/branding/sxc-mark-dark.svg",
  import.meta.url,
);
const outDir = new URL("../apps/web/public/icons/", import.meta.url);
const appIconOut = new URL("../apps/web/src/app/icon.png", import.meta.url);
const faviconOut = new URL("../apps/web/src/app/favicon.ico", import.meta.url);
const ogOut = new URL("../apps/web/public/og-image.png", import.meta.url);
const mark = await readFile(markPath);

// Charcoal background tile. `rx` rounds the corners for the standard
// home-screen icon; pass rx=0 for full-bleed (maskable + apple-touch, where
// the OS supplies its own mask).
const bgSvg = (size, rx) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rx}" ry="${rx}" fill="${ICON_BG}"/>
</svg>`;

/**
 * Render a charcoal tile with the S×C diamond mark centred.
 * @param size      output pixel size
 * @param rx        corner radius (0 = full bleed)
 * @param widthFrac mark width as a fraction of the tile (smaller for
 *                  maskable so the glyph stays inside the 80% safe zone)
 */
async function tile(size, rx, widthFrac) {
  const bg = await sharp(Buffer.from(bgSvg(size, rx))).png().toBuffer();
  const logoW = Math.round(size * widthFrac);
  const logo = await sharp(mark, { density: 512 })
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

function icoFromPngs(entries) {
  const headerSize = 6 + entries.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = headerSize;
  entries.forEach(({ size, png }, index) => {
    const base = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, base);
    header.writeUInt8(size === 256 ? 0 : size, base + 1);
    header.writeUInt8(0, base + 2);
    header.writeUInt8(0, base + 3);
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(png.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...entries.map(({ png }) => png)]);
}

for (const size of sizes) {
  // Standard rounded-square icon. iOS re-masks on top; Android may round too.
  await emit(`icon-${size}.png`, await tile(size, Math.round(size * 0.22), 0.72));
}

// Maskable: full-bleed background, wordmark kept inside the inner 80% safe
// zone so Android adaptive-icon masks never clip the glyph.
const maskable = await tile(512, 0, 0.62);
await emit("icon-maskable-512.png", maskable);

// Apple touch icon: full-bleed square (iOS rounds it itself), 180×180.
await emit("apple-touch-icon.png", await tile(180, 0, 0.72));

await writeFile(appIconOut, maskable);
console.log(`wrote src/app/icon.png (${maskable.length} bytes)`);

const faviconEntries = [];
for (const size of [16, 32, 48]) {
  faviconEntries.push({ size, png: await tile(size, 0, 0.74) });
}
const favicon = icoFromPngs(faviconEntries);
await writeFile(faviconOut, favicon);
console.log(`wrote src/app/favicon.ico (${favicon.length} bytes)`);

const ogMark = await sharp(mark, { density: 512 })
  .resize({ width: 260 })
  .png()
  .toBuffer();
const ogMarkMeta = await sharp(ogMark).metadata();
const og = await sharp({
  create: {
    width: 1200,
    height: 630,
    channels: 4,
    background: { r: 15, g: 19, b: 16, alpha: 1 },
  },
})
  .composite([
    {
      input: ogMark,
      top: Math.round((630 - (ogMarkMeta.height ?? 0)) / 2),
      left: Math.round((1200 - (ogMarkMeta.width ?? 0)) / 2),
    },
  ])
  .png()
  .toBuffer();
await writeFile(ogOut, og);
console.log(`wrote public/og-image.png (${og.length} bytes)`);
