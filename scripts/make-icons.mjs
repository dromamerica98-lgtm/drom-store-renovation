// Generates the app icons from one SVG design (house + small budget chart, dark green and white).
// Usage: node scripts/make-icons.mjs   (needs Playwright's Chromium to rasterize the PNGs)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;

const ART = `
  <g fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round">
    <path d="M92 246 L206 152 L320 246"/>
    <path d="M122 224 V364 H290 V224"/>
    <path d="M182 364 V308 a24 24 0 0 1 48 0 V364"/>
  </g>
  <g fill="#fff">
    <rect x="324" y="298" width="32" height="66" rx="9"/>
    <rect x="369" y="254" width="32" height="110" rx="9"/>
    <rect x="414" y="198" width="32" height="166" rx="9"/>
  </g>
  <path d="M76 392 H448" stroke="#fff" stroke-width="20" stroke-linecap="round"/>`;

/**
 * rounded: transparent rounded corners (for "any" icons and the favicon).
 * scale: artwork size; maskable icons keep it inside the central safe zone (radius 40%).
 */
function svg({ rounded, scale }) {
  const transform = `translate(256 256) scale(${scale}) translate(-262 -272)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b6b45"/>
      <stop offset="1" stop-color="#0f4a2e"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  <g transform="${transform}">${ART}
  </g>
</svg>
`;
}

const files = [
  // [path, size, options]
  ['public/icons/icon-192.png', 192, { rounded: true, scale: 0.86 }],
  ['public/icons/icon-512.png', 512, { rounded: true, scale: 0.86 }],
  ['public/icons/icon-maskable-192.png', 192, { rounded: false, scale: 0.78 }],
  ['public/icons/icon-maskable-512.png', 512, { rounded: false, scale: 0.78 }],
  // iOS rounds the corners itself and shows transparency as black, so the square is full-bleed.
  ['public/apple-touch-icon.png', 180, { rounded: false, scale: 0.86 }],
  ['public/icons/favicon-32.png', 32, { rounded: true, scale: 0.9 }],
];

writeFileSync(`${root}public/icons/icon.svg`, svg({ rounded: true, scale: 0.86 }));

const { chromium } = require('playwright');
const browser = await chromium.launch();
for (const [path, size, opts] of files) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0">${svg(opts).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  // Only the rounded icons need transparency; full-bleed ones are saved without an alpha channel.
  await page.screenshot({ path: `${root}${path}`, omitBackground: opts.rounded });
  await page.close();
}
await browser.close();
console.log(`Wrote public/icons/icon.svg and ${files.length} PNG icons`);
