/**
 * Quote files are stored in a private R2 bucket and served only through the Worker.
 * The type is detected from the file's bytes, never from the name or the browser's
 * claim, and only PDF and raster images are accepted, so nothing uploaded can be
 * served back as HTML or script.
 */

export interface DetectedType {
  contentType: string;
  ext: string;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heif']);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return { contentType: 'application/pdf', ext: 'pdf' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return { contentType: 'image/png', ext: 'png' };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { contentType: 'image/webp', ext: 'webp' };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (HEIC_BRANDS.has(brand)) return { contentType: 'image/heic', ext: 'heic' };
    if (HEIF_BRANDS.has(brand)) return { contentType: 'image/heif', ext: 'heif' };
  }
  return null;
}

/**
 * Cleans a user-supplied file name for display and download: drops any path, control
 * characters and bidi overrides (which can disguise an extension), limits the length and
 * makes sure the extension matches the detected type.
 */
export function sanitizeFileName(name: string, type: DetectedType): string {
  let clean = (name.split(/[/\\]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length > 150) clean = clean.slice(0, 150).trim();
  if (!clean || clean.startsWith('.')) clean = `הצעת-מחיר${clean}`;
  const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.') + 1).toLowerCase() : '';
  const allowed = type.ext === 'jpg' ? ['jpg', 'jpeg'] : [type.ext];
  return allowed.includes(ext) ? clean : `${clean}.${type.ext}`;
}

/** A Content-Disposition header with an ASCII fallback and the UTF-8 (Hebrew) name. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
