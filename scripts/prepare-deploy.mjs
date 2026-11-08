// Prepares a production deployment after `vite build`:
// 1. Embeds the built web app (dist/client) into dist/deploy/client-assets.js, so the Worker
//    serves it itself and every request passes the Cloudflare Access check.
// 2. Writes wrangler.deploy.json from wrangler.jsonc: same name, bindings and vars, but the
//    production entry point and no Workers Static Assets.
// Usage: node scripts/prepare-deploy.mjs   (then: wrangler deploy --config wrangler.deploy.json)

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const clientDir = join(root, 'dist/client');
const outDir = join(root, 'dist/deploy');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const SKIP = new Set(['.assetsignore', '.vite']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// Removes line and block comments outside strings (enough for wrangler.jsonc).
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else {
      out += c;
    }
  }
  return out;
}

// 1. Embed the web app.
const assets = {};
let total = 0;
for (const file of walk(clientDir)) {
  const path = '/' + relative(clientDir, file).split(sep).join('/');
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`No content type for ${path}`);
  const body = readFileSync(file);
  total += body.length;
  assets[path] = {
    b: body.toString('base64'),
    t: type,
    e: `"${createHash('sha256').update(body).digest('hex').slice(0, 20)}"`,
    i: path.startsWith('/assets/'),
  };
}
if (!assets['/index.html']) throw new Error('dist/client/index.html is missing; run `vite build` first');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'client-assets.js'), `export default ${JSON.stringify(assets)};\n`);

// 2. Production wrangler config.
const config = JSON.parse(stripJsonComments(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')));
delete config.assets;
delete config.$schema;
config.main = './src/worker/deploy-entry.ts';
config.alias = { ...config.alias, 'virtual:client-assets': './dist/deploy/client-assets.js' };
config.define = { ...config.define, 'import.meta.env.DEV': 'false' };
writeFileSync(join(root, 'wrangler.deploy.json'), JSON.stringify(config, null, 2) + '\n');

console.log(`Embedded ${Object.keys(assets).length} files (${(total / 1024).toFixed(0)} KB) and wrote wrangler.deploy.json`);
if (!config.vars?.ACCESS_AUD) console.warn('Warning: ACCESS_AUD is empty, so the deployed app will refuse every request.');
