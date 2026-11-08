/** Upload limits shared by the app and the API. */

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** The `accept` attribute for quote file inputs: PDF and photos. */
export const QUOTE_FILE_ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPdf(contentType: string): boolean {
  return contentType === 'application/pdf';
}
