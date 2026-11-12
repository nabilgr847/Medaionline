// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Builds the 1200x630 social preview image from the brand banner.
// Run: node scripts/make-og-image.mjs   (only needed when the banner changes)
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../public/branding/medai-banner.png");
const out = join(here, "../public/branding/og-image.jpg");

const info = await sharp(src)
  .resize(1200, 630, { fit: "cover", position: "centre" })
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(out);

console.log(`og-image.jpg ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)} KB`);
