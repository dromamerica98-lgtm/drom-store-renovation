import { describe, expect, it } from 'vitest';
import { contentDisposition, detectFileType, sanitizeFileName } from './files';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('detectFileType', () => {
  it('recognizes PDF and supported images by their bytes', () => {
    expect(detectFileType(bytes('%PDF-1.7\n'))?.contentType).toBe('application/pdf');
    expect(detectFileType(bytes([0xff, 0xd8, 0xff, 0xe0]))?.contentType).toBe('image/jpeg');
    expect(detectFileType(bytes([0x89], 'PNG\r\n', [0x1a], '\n'))?.contentType).toBe('image/png');
    expect(detectFileType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))?.contentType).toBe('image/webp');
    expect(detectFileType(bytes([0, 0, 0, 0x18], 'ftypheic'))?.contentType).toBe('image/heic');
    expect(detectFileType(bytes([0, 0, 0, 0x18], 'ftypmif1'))?.contentType).toBe('image/heif');
  });

  it('rejects anything else, whatever it is called', () => {
    expect(detectFileType(bytes('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectFileType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectFileType(bytes('GIF89a'))).toBeNull();
    expect(detectFileType(bytes('PK', [3, 4]))).toBeNull();
    expect(detectFileType(bytes([0, 0, 0, 0x18], 'ftypavif'))).toBeNull();
    expect(detectFileType(new Uint8Array())).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  const pdf = { contentType: 'application/pdf', ext: 'pdf' };
  const jpg = { contentType: 'image/jpeg', ext: 'jpg' };

  it('keeps a normal Hebrew name', () => {
    expect(sanitizeFileName('הצעה חשמל.pdf', pdf)).toBe('הצעה חשמל.pdf');
    expect(sanitizeFileName('IMG_1234.JPEG', jpg)).toBe('IMG_1234.JPEG');
  });

  it('drops paths, control characters and bidi overrides', () => {
    expect(sanitizeFileName('C:\\Users\\x\\quote.pdf', pdf)).toBe('quote.pdf');
    expect(sanitizeFileName('../../etc/quote.pdf', pdf)).toBe('quote.pdf');
    expect(sanitizeFileName('invoice\u202Efdp.exe', pdf)).toBe('invoicefdp.exe.pdf');
    expect(sanitizeFileName('a\u0000b\nc.pdf', pdf)).toBe('abc.pdf');
  });

  it('adds the real extension when it does not match the content', () => {
    expect(sanitizeFileName('quote.html', pdf)).toBe('quote.html.pdf');
    expect(sanitizeFileName('scan', jpg)).toBe('scan.jpg');
  });

  it('names empty or hidden files', () => {
    expect(sanitizeFileName('', pdf)).toBe('הצעת-מחיר.pdf');
    expect(sanitizeFileName('.pdf', pdf)).toBe('הצעת-מחיר.pdf');
  });

  it('limits the length', () => {
    expect(sanitizeFileName(`${'א'.repeat(300)}.pdf`, pdf).length).toBeLessThanOrEqual(155);
  });
});

describe('contentDisposition', () => {
  it('encodes Hebrew names with an ASCII fallback', () => {
    expect(contentDisposition('inline', 'הצעה "א".pdf')).toBe(
      `inline; filename="____ ___.pdf"; filename*=UTF-8''${encodeURIComponent('הצעה "א".pdf')}`,
    );
  });
});
