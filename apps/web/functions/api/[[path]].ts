/**
 * Pages Function: forwards every /api/* request to the API Worker through a
 * service binding. The API Worker has no public URL of its own, so the only
 * way in is through this (Cloudflare Access–protected) Pages origin, and the
 * browser only ever talks to a single origin — no CORS, no tokens in JS.
 */
interface PagesEnv {
  API: Fetcher;
}

export const onRequest: PagesFunction<PagesEnv> = (context) => context.env.API.fetch(context.request);
