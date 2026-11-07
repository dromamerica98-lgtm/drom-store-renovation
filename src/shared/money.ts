/** Helpers for converting between user input (shekels) and stored integer agorot. */

const ilsFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Formats agorot as whole shekels, e.g. 12345600 → "‏123,456 ₪". */
export function formatILS(agorot: number): string {
  return ilsFormatter.format(Math.round(agorot / 100));
}

const numberFormatter = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });

/** Formats agorot as whole shekels without the currency sign, for table columns. */
export function formatNumber(agorot: number): string {
  return numberFormatter.format(Math.round(agorot / 100));
}

/** Formats agorot with an explicit sign, e.g. "+12,000 ₪" / "-3,000 ₪". */
export function formatSignedILS(agorot: number): string {
  const sign = agorot > 0 ? '+' : agorot < 0 ? '-' : '';
  return sign + formatILS(Math.abs(agorot));
}

/**
 * Parses a shekel amount typed by the user ("1,234.50", "1234", "-500") into agorot.
 * Returns null for an empty or invalid value.
 */
export function parseShekels(input: string): number | null {
  const cleaned = input.replace(/[,\s₪]/g, '');
  if (cleaned === '' || !/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Converts agorot to a shekel string for an input field, e.g. 123456750 → "1,234,567.5". */
export function agorotToInput(agorot: number | null | undefined): string {
  if (agorot === null || agorot === undefined) return '';
  return (agorot / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}
