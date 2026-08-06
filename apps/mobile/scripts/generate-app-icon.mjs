import sharp from "sharp";
import { writeFile, mkdir, readFile } from "node:fs/promises";

// Generates the 1024×1024 iOS app-icon master for @capacitor/assets.
// Full-bleed charcoal (#1A1A1A) tile with the compact S×C mark — iOS rounds the
// corners itself, so no radius here. Matches the PWA icon + splash branding.

const SIZE = 1024;
const ICON_BG = "#1a1a1a";

const mark = await readFile(
  new URL("../../web/public/branding/sxc-mark-dark.svg", import.meta.url),
);

const bg = await sharp({
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: { r: 26, g: 26, b: 26, alpha: 1 },
  },
})
  .png()
  .toBuffer();

const logoW = Math.round(SIZE * 0.72);
const logo = await sharp(mark, { density: 1024 })
  .resize({ width: logoW })
  .png()
  .toBuffer();
const logoH = (await sharp(logo).metadata()).height ?? 0;

const icon = await sharp(bg)
  .composite([
    {
      input: logo,
      top: Math.round((SIZE - logoH) / 2),
      left: Math.round((SIZE - logoW) / 2),
    },
  ])
  .flatten({ background: ICON_BG })
  .png()
  .toBuffer();

await mkdir(new URL("../assets/", import.meta.url), { recursive: true });
await writeFile(new URL("../assets/icon.png", import.meta.url), icon);
await writeFile(
  new URL("../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", import.meta.url),
  icon,
);
console.log(`wrote assets/icon.png (${icon.length} bytes)`);
console.log("wrote AppIcon.appiconset/AppIcon-512@2x.png");
