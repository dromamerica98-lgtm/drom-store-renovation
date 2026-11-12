/**
 * @coach/shared — the API contract between the Worker (apps/api) and the
 * PWA (apps/web). Only types live here; both sides import them so a contract
 * change is a compile error on whichever side falls behind.
 */

export interface StatusResponse {
  ok: true;
  service: 'coach-api';
  engineVersion: string;
  garminMode: 'mock' | 'live';
  time: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
