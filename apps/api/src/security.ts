/**
 * Keeps secrets and personal details out of error messages that are stored
 * (sync_state, sync_runs) or returned to the client.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization header values
  [/\b(Bearer|ApiKey|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
  // JWT-shaped strings
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[redacted-jwt]'],
  // key=value / token=value pairs in URLs or text
  [/\b(api[_-]?key|access[_-]?token|token|secret|password|authorization)=([^&\s"']+)/gi, '$1=[redacted]'],
  // long opaque strings (32+ chars of base64/hex alphabet)
  [/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '[redacted]'],
  // email addresses
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
];

export function sanitizeMessage(message: string, maxLength = 300): string {
  let out = message;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

export function errorMessage(e: unknown): string {
  return sanitizeMessage(e instanceof Error ? e.message : String(e));
}
