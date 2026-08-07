import sharp from "sharp";
import { writeFile, readFile } from "node:fs/promises";

// Generates the 2732×2732 native launch (splash) image for the iOS shell:
// charcoal (#1A1A1A) field with the compact S×C mark centred. Overwrites the three
// splash variants Capacitor's iOS template ships. Matches the PWA splash brand.

const SIZE = 2732;

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

const logoW = Math.round(SIZE * 0.28);
const logo = await sharp(mark, { density: 1024 })
  .resize({ width: logoW })
  .png()
  .toBuffer();
const logoH = (await sharp(logo).metadata()).height ?? 0;

const splash = await sharp(bg)
  .composite([
    {
      input: logo,
      top: Math.round((SIZE - logoH) / 2),
      left: Math.round((SIZE - logoW) / 2),
    },
  ])
  .png()
  .toBuffer();

const setDir = new URL(
  "../ios/App/App/Assets.xcassets/Splash.imageset/",
  import.meta.url,
);
for (const name of [
  "splash-2732x2732.png",
  "splash-2732x2732-1.png",
  "splash-2732x2732-2.png",
]) {
  await writeFile(new URL(name, setDir), splash);
  console.log(`wrote ${name} (${splash.length} bytes)`);
}
