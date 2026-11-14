# Deployment

Garmin Coach runs as **one Cloudflare Worker** that serves the PWA (Workers
Static Assets), the JSON API under `/api/*` and the hourly Garmin sync, with
its own D1 database, behind its own Cloudflare Access application.

It shares the Cloudflare account with an unrelated production app. Nothing
here touches that app: every resource below is new and uniquely named, and
no routes, DNS records, custom domains or existing Access policies are used.

## Resources

| Resource | Name | Notes |
| --- | --- | --- |
| Worker | `garmin-personal-coach` | `https://garmin-personal-coach.<account-subdomain>.workers.dev`; `workers_dev: true`, `preview_urls: false`; cron `17 * * * *` |
| D1 database | `garmin-coach-db` | location hint `eeur`; migrations in `apps/api/migrations` |
| Access policy | `Garmin Coach – owner only` | reusable; Allow; include = owner email only |
| Access application | `Garmin Coach Private Access` | self-hosted; domain = the Worker hostname (all paths); login via one-time PIN; session 30 days |
| Worker secrets | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAIL` | config kept out of the repo |
| Worker secrets (live mode) | `GARMIN_PERSONAL_API_KEY` | added by the owner in the dashboard; never in the repo, chat or browser |

## Security model

1. **Access at the edge** — every request to the hostname (app, API,
   manifest, icons) must carry a valid Access session for the owner's email.
2. **JWT check in the Worker** — every `/api/*` request must also carry a
   valid `Cf-Access-Jwt-Assertion`: RS256 signature against the team's keys,
   this application's AUD, issuer, expiry and the owner's email. If Access
   were misconfigured or removed, the API still returns `401` for everyone.
   The check fails closed when the secrets are missing.
3. **No preview hostnames** (`preview_urls: false`) that could sit outside
   the Access application.
4. **No personal data at rest on the device** — API responses are
   `Cache-Control: no-store, private`; the service worker never intercepts
   `/api/*` and only caches the app shell; *Sign out* clears all caches and
   ends the Access session (`/cdn-cgi/access/logout`).
5. **Headers** — CSP (`default-src 'self'`, no inline scripts, no framing),
   HSTS, `nosniff`, `X-Frame-Options: DENY`, restrictive `Permissions-Policy`.
6. **Errors** — clients get generic messages; stored/logged errors pass through
   `sanitizeMessage` (removes bearer/API keys, JWTs, `token=` pairs, long
   opaque strings and emails).
7. **Secrets** — the Garmin key is a Worker secret, read only by the Worker;
   it never reaches the bundle (`apps/web/dist` is checked after each build).

## First deployment

Prerequisites: an API token for **this project only** with Account →
*Workers Scripts: Edit*, *D1: Edit*, *Access: Apps and Policies: Edit*.

```bash
export CLOUDFLARE_ACCOUNT_ID=<account id>
```

1. **Database** — create it, then put the printed id in
   `apps/api/wrangler.jsonc` (`d1_databases[0].database_id`):

   ```bash
   npx wrangler d1 create garmin-coach-db --location eeur
   ```

   ```bash
   npm run db:migrate:remote --workspace @coach/api
   ```

2. **Access, before the Worker exists** (so there is never an unprotected
   moment): create the reusable policy *Garmin Coach – owner only* (Allow,
   include *Emails* = owner) and the self-hosted application
   *Garmin Coach Private Access* for the Worker hostname with that policy,
   one-time PIN login and a 30-day session. Note the application's **AUD tag**.

3. **Deploy** the Worker (builds the PWA first):

   ```bash
   npm run deploy
   ```

4. **Secrets** (prompted; values never echoed):

   ```bash
   npx wrangler secret put ACCESS_TEAM_DOMAIN --name garmin-personal-coach
   ```

   ```bash
   npx wrangler secret put ACCESS_AUD --name garmin-personal-coach
   ```

   ```bash
   npx wrangler secret put OWNER_EMAIL --name garmin-personal-coach
   ```

   Until all three are set the API answers `401` to everyone (fail closed).

## Routine deployment

```bash
npm run check && npm run deploy
```

New migrations first, when there are any:

```bash
npm run db:migrate:remote --workspace @coach/api
```

## Verification checklist

| Check | Expected |
| --- | --- |
| `GET /` without an Access session | `302` to `<team>.cloudflareaccess.com` login |
| `GET /api/status` without a session | `302` to login (edge) |
| `/api/*` reaching the Worker without a valid JWT | `401 {"error":{"code":"unauthorized"}}` (tested in `auth.test.ts`) |
| After login: `/`, `/manifest.webmanifest`, `/sw.js`, `/icons/*` | `200` |
| API response headers | `Cache-Control: no-store, private` |
| Built bundle | contains no `GARMIN_PERSONAL_API_KEY`, `ApiKey`, `Bearer`, `connectapi` |
| Other app's Worker, D1, R2 and Access app/policy | unchanged (`modified_on`, bindings, policies compared before/after) |

## iPhone

Open the URL in Safari → sign in with the emailed one-time code → Share →
**Add to Home Screen**. The manifest is requested with credentials so it loads
behind Access. When the 30-day session ends, the app shows *Sign in again*;
tapping it reloads into the Access login.

## Rollback

* **Code** — list versions and roll back the Worker (assets roll back with it):

  ```bash
  npx wrangler deployments list --name garmin-personal-coach
  ```

  ```bash
  npx wrangler rollback --name garmin-personal-coach
  ```

* **Data** — D1 Time Travel restores the database to a point in time:

  ```bash
  npx wrangler d1 time-travel info garmin-coach-db
  ```

  ```bash
  npx wrangler d1 time-travel restore garmin-coach-db --timestamp <ISO time>
  ```

* **Turn the API off immediately** — delete the `ACCESS_AUD` secret; the API
  fails closed with `401`.

* **Remove Garmin Coach entirely** — delete only these: the Worker
  `garmin-personal-coach`, the D1 database `garmin-coach-db`, the Access
  application *Garmin Coach Private Access* and the policy
  *Garmin Coach – owner only*. Nothing else in the account depends on them.

## Local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

`ACCESS_DEV_BYPASS=1` in `.dev.vars` skips the Access check **only** for
requests to `localhost`/`127.0.0.1`; it is never set on the deployed Worker,
and requests to any other hostname are still verified.
