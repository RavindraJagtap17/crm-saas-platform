# Environment Variables

All configuration is read once at startup through `backend/src/config/index.js` — nothing else in
the codebase reads `process.env` directly. Copy `backend/.env.example` to `backend/.env` and fill
in real values; `.env` is git-ignored and must never be committed.

## Active as of Step 1

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` or `production` — controls error detail, log format |
| `PORT` | `4000` | Port the API listens on |
| `APP_URL` | `http://localhost:4000` | This API's own public URL |
| `FRONTEND_URL` | `http://localhost:3000` | Where the frontend is served from |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Comma-separated list of origins allowed to call the API from a browser. Empty means no cross-origin browser requests are allowed — safe by default. Never set to `*` in production. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug` |

None of these are currently required to start the server — every one has a safe default, so
`npm run dev` works right after `npm install` with no `.env` file at all. As later steps add real
requirements (a database connection, a JWT secret, …), those variables will be added to the
`REQUIRED` list in `backend/src/config/index.js`, and the app will fail fast at startup — not at
first use — if one is missing.

## Active as of Step 2 — database

| Variable | Default | Purpose |
|---|---|---|
| `DB_HOST` | `127.0.0.1` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_NAME` | `crm_dev` | Database name — must already exist; migrations create tables inside it, not the database itself |
| `DB_USER` | `root` | MySQL user |
| `DB_PASSWORD` | *(empty)* | MySQL password |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `2` / `10` | Sizing for the application's own connection pool (`src/config/db.js`) |

`DB_HOST`, `DB_NAME`, and `DB_USER` are required. As of Step 3 this applies to the running Express
app itself, not just `migrations/migrate.js` and `seeders/001_roles.js` — the app now queries the
database (user lookup, tenant creation, refresh tokens), so it fails fast at startup if these are
missing rather than failing on the first request that needs them.

## Active as of Step 3 — Google Sign-In & sessions

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | The OAuth 2.0 Web Client ID from Google Cloud Console → APIs & Services → Credentials. Used both server-side (to verify that an ID token was really issued for this app) and by the frontend (to render the Sign-In button) — not a secret in the traditional sense, but sign-in cannot work without a real one configured in Google Cloud. |
| `JWT_ACCESS_SECRET` | Signs the ~15-minute access token. Random, high-entropy, environment-specific. |
| `JWT_REFRESH_SECRET` | **Not** used to sign a JWT — refresh tokens are opaque random values, not JWTs (see below). This is the HMAC key used to hash a refresh token before it's stored, so a database leak alone can't be replayed as a valid session. |
| `JWT_ACCESS_EXPIRY` | Access token lifetime. `15m` per the approved spec. |
| `JWT_REFRESH_EXPIRY` | Refresh token lifetime and refresh cookie `maxAge`. `30d` per the approved spec. |

Generate both secrets locally with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Why the refresh token isn't a JWT:** a signed JWT can prove it hasn't been *tampered with*, but
it can't be individually *revoked* without a server-side blacklist anyway — so this implementation
skips the signed-token step entirely. A refresh token is a random 384-bit value; the server stores
only its HMAC (via `JWT_REFRESH_SECRET`) in the `refresh_tokens` table, alongside an expiry and a
revoked flag. That's what makes rotation-with-reuse-detection and logout-revocation possible.

## Active as of Step 7 — Meta Lead Ads

| Variable | Default | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | *(required)* | 64-character hex string (32 bytes) used for AES-256-GCM encryption of Meta access tokens at rest. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Not reused for anything else — a leak of this key only exposes Meta tokens, not JWT sessions. |
| `META_APP_ID` | *(required)* | From developers.facebook.com → your App → Settings → Basic. Public-ish (sent to the browser as part of the OAuth dialog URL) but still required to be a real, configured Meta App for OAuth to work. |
| `META_APP_SECRET` | *(required)* | From the same App Settings page. Used server-side only: to exchange OAuth codes for tokens, and as the HMAC key verifying `X-Hub-Signature-256` on every inbound webhook — never sent to the browser. |
| `META_WEBHOOK_VERIFY_TOKEN` | *(required)* | **Not** issued by Meta — an arbitrary string you choose yourself and enter into the App Dashboard's Webhooks config. Meta echoes it back on the one-time GET verification handshake so the subscription setup can be confirmed as legitimate. |
| `META_GRAPH_API_VERSION` | `v19.0` | Graph API version prefix for every Meta API call. |
| `META_REDIRECT_URI` | `${APP_URL}/api/meta/oauth/callback` | Where Meta redirects the browser after the user authorizes. Must exactly match a redirect URI registered in the Meta App's OAuth settings. |

Same "no real credentials in this sandboxed environment" situation as `GOOGLE_CLIENT_ID` in Step 3:
`META_APP_ID`/`META_APP_SECRET` ship as placeholders in `.env`. The server boots and every
non-Graph-API-dependent code path (webhook signature verification, tenant resolution via
`page_id`, field mapping, `leadService.createLead` reuse, `meta_lead_id` idempotency, token-at-rest
encryption, RBAC/tenant isolation) was verified for real against the local database with a mocked
Graph API response layer — see the Step 7 report for what that covered and how.

## Step 8 — Meta Conversions API (CAPI)

No new environment variables. CAPI reuses the Step 7 Meta connection entirely — same
`META_APP_ID`/`META_APP_SECRET`/`ENCRYPTION_KEY`, same encrypted token, same `graphClient` module.
The one new piece of configuration it needs (the tenant's Meta Pixel/Dataset ID) is per-tenant
data, not environment-wide, so it lives in the database (`meta_integration_settings.pixel_id`,
set via `PATCH /api/meta/connection` — see `docs/API.md`) rather than as an env var.

## Active as of Step 9 — Razorpay Subscription Billing

| Variable | Default | Purpose |
|---|---|---|
| `RAZORPAY_KEY_ID` | *(required)* | From the Razorpay Dashboard → Settings → API Keys (use Test Mode keys for local dev). This is Razorpay's **public** key — also read by the frontend (`frontend/config.js`) to open Checkout, the same trust level as `GOOGLE_CLIENT_ID`. |
| `RAZORPAY_KEY_SECRET` | *(required)* | From the same API Keys page. Server-side only — used as HTTP Basic Auth for every outbound Razorpay API call (`backend/src/integrations/razorpay/razorpayClient.js`). Never sent to the browser, never logged. |
| `RAZORPAY_WEBHOOK_SECRET` | *(required)* | **Not** the same value as `RAZORPAY_KEY_SECRET` — a separate secret you set when configuring the webhook itself (Dashboard → Settings → Webhooks). Verifies `X-Razorpay-Signature` on every inbound webhook. |

Same "no real credentials in this sandboxed environment" situation as `GOOGLE_CLIENT_ID`/
`META_APP_ID` in earlier steps: `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` ship as placeholders in
`.env`. The server boots and every non-Razorpay-API-dependent code path (webhook signature
verification, idempotency, tenant/plan resolution, the full activation/gating/reconciliation state
machine, and every failure path) was verified for real against the local database with a mocked
Razorpay API response layer — see the Step 9 report for what that covered and how. Real end-to-end
testing against Razorpay Test Mode additionally requires a publicly reachable HTTPS endpoint for
webhook delivery (a tunnel like ngrok, or a staging deployment) — Razorpay cannot reach `localhost`.

See `docs/API.md`'s "Razorpay Subscription Billing" section for the local plan catalog vs. Razorpay
Plan distinction, the full signup/checkout/webhook flow, and exactly which webhook events are
handled.

## Reserved for later steps

Nothing currently reserved — WhatsApp, YaGo, and every other future-phase feature are out of scope
for this project's approved phases and have no environment variables allocated.

See Section 26 of the Final Specification for the complete, final list.
