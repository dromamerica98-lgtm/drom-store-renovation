/** Bindings and vars available to the Worker (see wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  /** "mock" serves synthetic Garmin data; "live" calls the Garmin Personal API (Stage 6). */
  GARMIN_MODE: 'mock' | 'live';
  /** Mock data scenario, mock mode only. */
  MOCK_SCENARIO?: string;
  /** Secret (wrangler secret put). Never sent to the client. Used from Stage 6. */
  GARMIN_PERSONAL_API_KEY?: string;
}
