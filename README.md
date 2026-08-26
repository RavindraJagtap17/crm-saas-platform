# CRM Phase 1

Multi-tenant, white-labeled SaaS CRM for lead and client management — Meta Lead Ads, a universal
website enquiry form, Meta Conversions API, and Razorpay subscription billing.

The single source of truth for architecture and requirements is the approved
**CRM Phase 1 Final Specification**. This repository implements it incrementally, one approved
step at a time.

## Status

**Steps 1–6 complete: scaffold, database schema, authentication, the lead engine, the frontend, and the website enquiry form.**

- Step 1 — Express scaffold, folder structure, `/health`.
- Step 2 — Core MySQL schema via versioned migrations (tenants, roles, users, leads, and related tables); roles seeded.
- Step 3 — Google Sign-In, JWT sessions with rotating/revocable refresh tokens, tenant-scope and role-based authorization middleware, self-service first Tenant Admin signup.
- Step 4 — Lead CRUD, manual entry, status pipeline, sources, products, dynamic custom fields, duplicate detection/flagging, manual assignment, call activities, and status history — all tenant-scoped and role-gated.
- Step 5 — Role-specific frontend (Super Admin, Tenant Admin, Employee) in plain HTML/CSS/JS, a shared design system, white-label branding, dashboards, and full lead-management UI. A few small backend additions (tenant branding, employee invitation, dashboard aggregates, Super Admin tenant management) were built alongside it — see `docs/API.md`.
- Step 6 — Universal website enquiry form: an embeddable script widget (Shadow DOM–isolated) and an iframe fallback, both backed by one public submission API that reuses the Step 4 lead engine unchanged — same duplicate detection, same custom-field validation, same tenant scoping. Per-tenant domain allowlisting, honeypot, and IP rate limiting. Tenant Admins manage forms from a new **Website Forms** page.

Still not built: Meta Lead Ads/CAPI, Razorpay billing.

## Tech stack

- Frontend: HTML5, CSS3, vanilla JavaScript (no framework, no build step)
- Backend: Node.js, Express.js
- Database: MySQL
- Auth: Google Sign-In only — no passwords anywhere in this system
- Target hosting: Plesk

## Project structure

```
backend/    Express API (src/config, routes, controllers, services, models,
            middlewares, validators, integrations, jobs, utils)
frontend/   Static site — see "Frontend structure" below
docs/       Deployment, environment, and API reference docs
```

### Frontend structure

```
frontend/
├── config.js               Runtime config: API_BASE_URL, GOOGLE_CLIENT_ID (edited per environment)
├── serve.json               Local-dev-only server config (see note below)
├── public/                  One folder per role area — every page is a plain .html file
│   ├── auth/                 Sign in, create-agency signup
│   ├── super-admin/           Platform overview, tenant detail
│   ├── admin/                  Tenant Admin: dashboard, leads, statuses, sources, products,
│   │                            custom fields, employees, branding, billing
│   ├── employee/                Employee: dashboard, my leads, lead detail
│   └── embed/                    crm-lead-widget.js (script embed) + lead-form.html (iframe fallback)
└── src/
    ├── css/                  tokens.css (design tokens) → base.css → components.css → layout.css
    └── js/
        ├── api/               client.js (centralized fetch, auth, refresh-on-401), resources.js
        ├── components/         toast, modal, shell (nav), dataTable, chart, leadForm, ui helpers
        ├── pages/               one controller module per .html page
        ├── session.js           in-memory access token + role-based routing guard
        └── branding.js           applies a tenant's logo/name/color at runtime
```

No bundler, no framework — every page is `<script type="module">` importing plain ES modules.
The access token is kept in memory only (never localStorage/sessionStorage); each page
re-establishes its own session on load via the httpOnly refresh cookie, so the refresh flow is
exercised on every page view, not just at login.

One deliberate exception: `public/embed/crm-lead-widget.js` is a plain IIFE, not a module — it has
to work when a third-party site drops it in via a bare `<script src="...">` tag, so it can't rely
on `type="module"` or import anything else in `src/js/`. `public/embed/lead-form.html`'s own
controller (the iframe fallback), by contrast, is served from this app's own origin and follows
the normal module pattern like every other page.

## Local development

See [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for environment variables and
[`docs/API.md`](docs/API.md) for the current API surface.

**Backend:**
```bash
cd backend
npm install
cp .env.example .env   # then fill in DB_*, JWT_*, and GOOGLE_CLIENT_ID
npm run migrate
npm run seed
npm run dev
```
The app requires a running MySQL database and real `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` /
`GOOGLE_CLIENT_ID` values to boot (see `docs/ENVIRONMENT.md`) — it fails fast with a clear error if
any are missing. A real `GOOGLE_CLIENT_ID` (from Google Cloud Console) is only needed for actual
Google Sign-In to succeed; the server itself starts fine with a placeholder value.

Confirm it's running: `curl http://localhost:4000/health`

**Frontend** — any static file server pointed at the `frontend/` folder works, e.g.:
```bash
npx serve frontend -l 3000
```
Then open `http://localhost:3000/public/auth/index.html`. Set `CORS_ALLOWED_ORIGINS` in the
backend's `.env` to match whatever origin you serve the frontend from (defaults to
`http://localhost:3000`).

`frontend/serve.json` disables the `serve` package's default "clean URLs" redirect and adds an
explicit rewrite instead — the redirect variant drops query strings (e.g. `lead-detail.html?id=5`
loses `?id=5` on redirect), which broke deep-linking to a specific lead. This is a local-dev-server
setting only; it doesn't change what the actual `.html` files or their links contain, and a plain
static host (Plesk included) serving the files as-is needs no equivalent configuration.

**Testing the website enquiry form locally** — create a form on the **Website Forms** admin page
(needs at least one Lead Source to exist first). `localhost` is accepted as an allowed domain
specifically so a local test page can embed the widget/iframe and have the domain check actually
pass (every other hostname must look like a real domain — bare `localhost` is a deliberate,
narrow exception, not a loosened check). See `docs/API.md`'s "Website enquiry form" section for
exactly how Origin is validated, including how `curl`/Postman testing works with no `Origin`
header at all outside production.

## Documentation

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — target Plesk deployment approach
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — environment variables, what's active vs. reserved
- [`docs/API.md`](docs/API.md) — current API endpoints
