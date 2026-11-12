/**
 * Renders the app icon SVG to the PNG sizes the PWA and iOS need.
 * Usage: node scripts/generate-icons.mjs   (uses the preinstalled Playwright Chromium)
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = fileURLToPath(new URL('../public/icons/', import.meta.url));

/** Pulse line rising into an arrow: "readiness → what to do". */
const glyph = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M96 300 H176 L212 214 L262 366 L306 246 L332 300 H372"/>
    <path d="M330 178 L416 178 L416 264"/>
    <path d="M372 300 L414 182"/>
  </g>`;

const svg = ({ rounded, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3987e5"/><stop offset="1" stop-color="#1c5cab"/>
  </linearGradient></defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#g)"/>
  ${glyph(scale)}
</svg>`;

const targets = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  // Maskable: full bleed, glyph inside the 80 % safe zone.
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.72 },
  // iOS applies its own corner mask; must be opaque and square.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.9 },
];

writeFileSync(`${out}favicon.svg`, svg({ rounded: true, scale: 1 }));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg(t).replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</body></html>`,
  );
  await page.screenshot({ path: `${out}${t.file}`, omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  console.log('wrote', t.file);
}
await browser.close();
