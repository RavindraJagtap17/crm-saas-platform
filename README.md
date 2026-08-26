# CRM Phase 1

Multi-tenant, white-labeled SaaS CRM for lead and client management — Meta Lead Ads, a universal
website enquiry form, Meta Conversions API, and Razorpay subscription billing.

The single source of truth for architecture and requirements is the approved
**CRM Phase 1 Final Specification**. This repository implements it incrementally, one approved
step at a time.

## Status

**Steps 1–4 complete: scaffold, database schema, authentication/tenant-scoping, and the lead engine.**

- Step 1 — Express scaffold, folder structure, `/health`.
- Step 2 — Core MySQL schema via versioned migrations (tenants, roles, users, leads, and related tables); roles seeded.
- Step 3 — Google Sign-In, JWT sessions with rotating/revocable refresh tokens, tenant-scope and role-based authorization middleware, self-service first Tenant Admin signup.
- Step 4 — Lead CRUD, manual entry, status pipeline, sources, products, dynamic custom fields, duplicate detection/flagging, manual assignment, call activities, and status history — all tenant-scoped and role-gated.

Still not built: employee-limit-aware invitation management, dashboard/analytics, the public website
enquiry form, Meta Lead Ads/CAPI, Razorpay billing. See `docs/API.md` for exactly what exists today.

## Tech stack

- Frontend: HTML5, CSS3, vanilla JavaScript (no framework)
- Backend: Node.js, Express.js
- Database: MySQL
- Auth: Google Sign-In only — no passwords anywhere in this system
- Target hosting: Plesk

## Project structure

```
backend/    Express API (src/config, routes, controllers, services, models,
            middlewares, validators, integrations, jobs, utils)
frontend/   Static site (public/ — one folder per app area; src/ — shared css & js)
docs/       Deployment, environment, and API reference docs
```

## Local development

See [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for environment variables and
[`docs/API.md`](docs/API.md) for the current API surface.

```bash
cd backend
npm install
cp .env.example .env   # then fill in DB_*, JWT_*, and GOOGLE_CLIENT_ID
npm run migrate
npm run seed
npm run dev
```

The app now requires a running MySQL database and real `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
/ `GOOGLE_CLIENT_ID` values to boot (see `docs/ENVIRONMENT.md`) — it fails fast with a clear error
if any are missing. A real `GOOGLE_CLIENT_ID` (from Google Cloud Console) is only needed for actual
Google Sign-In to succeed; the server itself starts fine with a placeholder value.

The API starts on `http://localhost:4000` by default. Confirm it's running:

```bash
curl http://localhost:4000/health
```

## Documentation

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — target Plesk deployment approach
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — environment variables, what's active vs. reserved
- [`docs/API.md`](docs/API.md) — current API endpoints
