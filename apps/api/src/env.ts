/** Bindings and vars available to the Worker (see wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  /** Static assets (the PWA build), served by Workers Static Assets. */
  ASSETS?: Fetcher;
  /** "mock" serves synthetic Garmin data; "live" calls the Garmin Personal API (Stage 6). */
  GARMIN_MODE: 'mock' | 'live';
  /** Mock data scenario, mock mode only. */
  MOCK_SCENARIO?: string;

  // --- Cloudflare Access (verified by the Worker on every /api request) ---
  /** Team domain, e.g. https://damp-bread-d7b5.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience (AUD) tag of the "Garmin Coach Private Access" application. */
  ACCESS_AUD?: string;
  /** The only email allowed to use the API. */
  OWNER_EMAIL?: string;
  /** Local development only (.dev.vars): "1" skips Access checks on localhost. Never set in production. */
  ACCESS_DEV_BYPASS?: string;

  /** Secret (wrangler secret put). Never sent to the client. Used from Stage 6. */
  GARMIN_PERSONAL_API_KEY?: string;
}
