import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const sizes = [192, 256, 384, 512];

// Standard rounded-square icon. iOS will apply its own corner mask on top of
// `apple-touch-icon`, so for that file we render a full-bleed square instead
// (see `appleSvg` below) — Apple composites poorly when given transparent or
// already-rounded sources.
const svgFor = (size) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" ry="${Math.round(size * 0.22)}" fill="#1a1a1a"/>
  <g font-family="system-ui, -apple-system, sans-serif" font-weight="800" text-anchor="middle" fill="#a3e635">
    <text x="${size / 2}" y="${size * 0.72}" font-size="${Math.round(size * 0.62)}">H</text>
  </g>
</svg>
`;

// Maskable icons need the glyph fully inside the inner 80% "safe zone" so
// Android/Chromium adaptive-icon masks don't crop the H. The background is
// drawn edge-to-edge with no corner radius (the OS supplies the mask).
const maskableSvgFor = (size) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a1a1a"/>
  <g font-family="system-ui, -apple-system, sans-serif" font-weight="800" text-anchor="middle" fill="#a3e635">
    <text x="${size / 2}" y="${size * 0.66}" font-size="${Math.round(size * 0.46)}">H</text>
  </g>
</svg>
`;

// Apple touch icon: full-bleed square, no transparency, no rounded corners.
// iOS rounds it itself. 180×180 is the modern home-screen size.
const appleSvg = (size) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a1a1a"/>
  <g font-family="system-ui, -apple-system, sans-serif" font-weight="800" text-anchor="middle" fill="#a3e635">
    <text x="${size / 2}" y="${size * 0.72}" font-size="${Math.round(size * 0.62)}">H</text>
  </g>
</svg>
`;

const outDir = new URL("../apps/web/public/icons/", import.meta.url);

async function emit(name, svg) {
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const path = new URL(name, outDir);
  await writeFile(path, buffer);
  console.log(`wrote ${name} (${buffer.length} bytes)`);
}

for (const size of sizes) {
  await emit(`icon-${size}.png`, svgFor(size));
}
await emit("icon-maskable-512.png", maskableSvgFor(512));
await emit("apple-touch-icon.png", appleSvg(180));
