import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const sizes = [192, 256, 384, 512];

const svgFor = (size) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" ry="${Math.round(size * 0.22)}" fill="#1a1a1a"/>
  <g font-family="system-ui, -apple-system, sans-serif" font-weight="800" text-anchor="middle" fill="#a3e635">
    <text x="${size / 2}" y="${size * 0.72}" font-size="${Math.round(size * 0.62)}">H</text>
  </g>
</svg>
`;

const outDir = new URL("../apps/web/public/icons/", import.meta.url);

for (const size of sizes) {
  const svg = Buffer.from(svgFor(size));
  const buffer = await sharp(svg).png().toBuffer();
  const path = new URL(`icon-${size}.png`, outDir);
  await writeFile(path, buffer);
  console.log(`wrote icon-${size}.png (${buffer.length} bytes)`);
}
