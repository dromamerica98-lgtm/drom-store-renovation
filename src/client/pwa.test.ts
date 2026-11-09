import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLogoutUrl } from './auth';
import { detectPlatform } from './install';

const root = new URL('../../', import.meta.url).pathname;
const read = (path: string) => readFileSync(root + path);
const manifest = JSON.parse(read('public/manifest.webmanifest').toString('utf8'));
const html = read('index.html').toString('utf8');

/** Width, height and color type (2 = RGB, 6 = RGBA) from a PNG header. */
function png(path: string) {
  const b = read(path);
  expect(b.subarray(0, 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
}

describe('web app manifest', () => {
  it('has what Android and iOS need to install the app', () => {
    expect(manifest.name).toBe('תקציב שיפוץ החנות');
    expect(manifest.short_name).toBe('תקציב שיפוץ');
    // Home screens cut labels after about 12 characters.
    expect([...manifest.short_name].length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('he');
    expect(manifest.dir).toBe('rtl');
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('lists 192 and 512 icons for both "any" and "maskable", and the files match', () => {
    for (const purpose of ['any', 'maskable']) {
      for (const size of [192, 512]) {
        const icon = manifest.icons.find((i: { sizes: string; purpose: string }) => i.sizes === `${size}x${size}` && i.purpose === purpose);
        expect(icon, `${purpose} ${size}`).toBeDefined();
        const file = png(`public${icon.src}`);
        expect([file.width, file.height]).toEqual([size, size]);
        // Maskable icons are cropped by the system, so they must fill the square (no transparency).
        if (purpose === 'maskable') expect(file.alpha).toBe(false);
      }
    }
    for (const icon of manifest.icons) expect(() => read(`public${icon.src}`)).not.toThrow();
  });
});

describe('index.html', () => {
  it('links the manifest with credentials, so it loads behind Cloudflare Access', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />');
  });

  it('has the iPhone home-screen icon, name and full-screen settings', () => {
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon.png"/);
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="תקציב שיפוץ" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain('viewport-fit=cover');
    const apple = png('public/apple-touch-icon.png');
    expect([apple.width, apple.height, apple.alpha]).toEqual([180, 180, false]);
  });
});

describe('detectPlatform', () => {
  it('recognizes iPhone, iPad (including desktop mode), Android and computers', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 0)).toBe('desktop');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('desktop');
  });
});

describe('buildLogoutUrl', () => {
  it('returns to the app root after the team logout', () => {
    expect(
      buildLogoutUrl(
        'https://damp-bread-d7b5.cloudflareaccess.com/cdn-cgi/access/logout',
        'https://drom-store-renovation.dromamerica98.workers.dev',
      ),
    ).toBe(
      'https://damp-bread-d7b5.cloudflareaccess.com/cdn-cgi/access/logout?returnTo=https%3A%2F%2Fdrom-store-renovation.dromamerica98.workers.dev%2F',
    );
  });
});
