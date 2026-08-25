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

## Active as of Step 2 (migration/seed tooling only)

| Variable | Default | Purpose |
|---|---|---|
| `DB_HOST` | `127.0.0.1` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_NAME` | `crm_phase1` | Database name — must already exist; migrations create tables inside it, not the database itself |
| `DB_USER` | `root` | MySQL user |
| `DB_PASSWORD` | *(empty)* | MySQL password |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `2` / `10` | Reserved for the application's connection pool, added when the app itself starts querying the database (a later step) |

`DB_HOST`, `DB_NAME`, and `DB_USER` are required — `migrations/migrate.js` and `seeders/001_roles.js`
fail fast with a clear message if any are missing. The running Express app (`npm run dev`) does
**not** read these yet and still starts with zero configuration, exactly as in Step 1 — only the
migration and seed scripts use the database right now.

## Reserved for later steps

These already exist in `backend/.env.example` for documentation, but nothing in the code reads
them yet:

| Group | Variables | Added when |
|---|---|---|
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID` | Google Sign-In is implemented |
| Meta | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | Meta Lead Ads / CAPI is implemented |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Billing is implemented |

See Section 26 of the Final Specification for the complete, final list.
