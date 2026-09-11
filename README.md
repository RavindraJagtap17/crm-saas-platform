# CRM Phase 1

Multi-tenant, white-labeled SaaS CRM for lead and client management — Meta Lead Ads, a universal
website enquiry form, Meta Conversions API, and Razorpay subscription billing.

The single source of truth for architecture and requirements is the approved
**CRM Phase 1 Final Specification**. This repository implements it incrementally, one approved
step at a time.

## Status

**Steps 1–10 complete: scaffold, database schema, authentication, the lead engine, the frontend, the website enquiry form, Meta Lead Ads integration, Meta Conversions API, Razorpay subscription billing, and final security hardening.**

- Step 1 — Express scaffold, folder structure, `/health`.
- Step 2 — Core MySQL schema via versioned migrations (tenants, roles, users, leads, and related tables); roles seeded.
- Step 3 — Google Sign-In, JWT sessions with rotating/revocable refresh tokens, tenant-scope and role-based authorization middleware, self-service first Tenant Admin signup.
- Step 4 — Lead CRUD, manual entry, status pipeline, sources, products, dynamic custom fields, duplicate detection/flagging, manual assignment, call activities, and status history — all tenant-scoped and role-gated.
- Step 5 — Role-specific frontend (Super Admin, Tenant Admin, Employee) in plain HTML/CSS/JS, a shared design system, white-label branding, dashboards, and full lead-management UI. A few small backend additions (tenant branding, employee invitation, dashboard aggregates, Super Admin tenant management) were built alongside it — see `docs/API.md`.
- Step 6 — Universal website enquiry form: an embeddable script widget (Shadow DOM–isolated) and an iframe fallback, both backed by one public submission API that reuses the Step 4 lead engine unchanged — same duplicate detection, same custom-field validation, same tenant scoping. Per-tenant domain allowlisting, honeypot, and IP rate limiting. Tenant Admins manage forms from a new **Website Forms** page.
- Step 7 — Meta Lead Ads integration: tenant-scoped Meta OAuth connection (one Facebook Page per tenant, enforced unambiguous by a database `UNIQUE` constraint), a shared inbound webhook that verifies Meta's signature and resolves the owning tenant strictly by `page_id`, per-tenant/per-form field mapping (core fields onto the lead, everything else into `leads.custom_fields`, unmapped fields dropped), and lead creation that reuses the Step 4 `leadService.createLead()` unchanged — same duplicate detection, same tenant scoping, same "starts unassigned" rule. Meta access tokens are encrypted at rest (AES-256-GCM) and never leave the server. Idempotent on Meta's own lead ID, independent of phone-based duplicate flagging. Tenant Admins manage the connection and field mappings from a new **Meta Lead Ads** page.
- Step 8 — Meta Conversions API: when a lead reaches its tenant's configured final status (Step 4's `lead_statuses.is_final`), a server-side conversion event is sent to that tenant's own Meta Pixel (extending the Step 7 connection with one manually-entered Pixel ID — not a second connection). Email/phone are hashed (SHA-256) before ever leaving the server; raw values are never sent, logged, or stored. A DB-backed queue (`meta_capi_events` — no new external infrastructure) handles sending, bounded retry-with-backoff for transient Meta failures, and permanent-failure detection for validation/auth errors. A CAPI failure can never roll back or delay the lead status change it originated from. Idempotent per-lead, independent of both webhook idempotency (Step 7) and phone-based duplicate detection (Step 4).
- Step 9 — Razorpay subscription billing: a new tenant starts `pending_payment` (unchanged Step 3 default) and stays locked out of the CRM interior — enforced by a new `requireActiveTenant` backend middleware, not just a frontend redirect — until a signed Razorpay webhook (never a browser redirect) confirms the subscription is genuinely active. Super Admin manages a local plan catalog that references (never edits) Razorpay's own immutable Plans. Tenant Admin can upgrade/downgrade their own plan (`now` or `cycle_end`, exactly what Razorpay supports); Super Admin can change, suspend (real Razorpay pause), or cancel any tenant's subscription. A payment ledger and webhook-driven state reconciliation are both idempotent (`razorpay_webhook_events`/`payments` unique constraints); a single failed payment never permanently locks a tenant out, and `employee_limit` stays 3 on activation exactly as it always has — never derived from the plan.

- Step 10 — Final security hardening / production-readiness pass: a full tenant-isolation audit (every model/service query, 10 explicit cross-tenant attack scenarios) found and fixed one genuine cross-tenant vulnerability (a client-writable `metaLeadId` on manual lead creation could pre-claim another tenant's Meta lead), added rate limiting to authentication and webhook endpoints (the one gap versus the public form's existing limiter), and hardened `payments.subscription_id` to the same composite tenant-scoped FK pattern used everywhere else in the schema. Full migration up/down round-trip verified from an empty database. No business functionality changed. See the Step 10 report for the complete findings list, regression results, and Final Phase 1 acceptance checklist.

**Frontend migration (post-Step-10)** — the Step 5 vanilla HTML/CSS/JS frontend was rebuilt as a
React + Vite SPA (`frontend-react/`), functionally equivalent: same design tokens/visual design,
same API contracts (backend untouched apart from a CORS allowlist addition for the Vite dev
server), same auth model (in-memory access token, httpOnly refresh cookie), every page and
feature carried over — including the CSV import preview/confirm flow, bulk lead actions, and all
four lead-source integrations. The old `frontend/` directory has been removed after full
verification (build, live role-by-role browser testing, and a real CSV import/bulk-action/agency-
creation round trip).

Still not built: WhatsApp, YaGo, and every other future-phase feature outside this project's approved scope.

## Tech stack

- Frontend: React 19 + Vite, React Router — see "Frontend structure" below
- Backend: Node.js, Express.js
- Database: MySQL
- Auth: Google Sign-In only — no passwords anywhere in this system
- Target hosting: Plesk

## Project structure

```
backend/         Express API (src/config, routes, controllers, services, models,
                  middlewares, validators, integrations, jobs, utils)
frontend-react/   React + Vite SPA — see "Frontend structure" below
docs/             Deployment, environment, and API reference docs
```

### Frontend structure

The frontend was originally built as a plain HTML/CSS/JS site (Step 5) and later migrated to a
React + Vite SPA, functionally equivalent, same design system and API contracts. The old
`frontend/` directory has been removed; `frontend-react/` is the only frontend now.

```
frontend-react/
├── .env / .env.example      Runtime config: VITE_API_BASE_URL, VITE_GOOGLE_CLIENT_ID,
│                              VITE_RAZORPAY_KEY_ID (edited per environment; Vite only exposes
│                              vars prefixed VITE_ to client code)
├── public/
│   ├── favicon.svg, icons.svg
│   └── public/embed/          crm-lead-widget.js (script embed) + lead-form.html (iframe
│                                fallback) — copied verbatim, served at the same fixed URL the
│                                widget is already embedded with on real third-party sites
└── src/
    ├── api/                  client.js (centralized fetch, auth, refresh-on-401), resources.js
    ├── auth/                  tokenStore.js (in-memory access token), AuthContext, ProtectedRoute
    ├── components/             Modal, DataTable, Pagination, Chart, LeadForm, FollowUpPanel,
    │                            toast/confirmDialog (pub/sub singletons), Badges, States
    ├── layouts/                 Shell (sidebar/topbar nav), nav.js, PageTitleContext
    ├── pages/                    auth/, admin/, employee/, agency/, super-admin/ — one component
    │                              per route
    ├── styles/                   tokens.css (design tokens) → base.css → components.css →
    │                              layout.css — carried over unchanged from the old frontend
    └── utils/                     format.js, qs.js, download.js, branding.js
```

The access token is kept in memory only (never localStorage/sessionStorage); the SPA
re-establishes its session once on load via the httpOnly refresh cookie, and `ProtectedRoute`
gates every route by role.

One deliberate exception: `public/public/embed/crm-lead-widget.js` is a plain IIFE, not a module —
it has to work when a third-party site drops it in via a bare `<script src="...">` tag, so it
can't rely on any bundler output or import anything else in `src/`. It's served as a static file,
untouched by the Vite build.

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

**Frontend:**
```bash
cd frontend-react
npm install
cp .env.example .env   # then fill in VITE_API_BASE_URL, VITE_GOOGLE_CLIENT_ID, VITE_RAZORPAY_KEY_ID
npm run dev
```
Then open `http://localhost:5173`. Set `CORS_ALLOWED_ORIGINS` in the backend's `.env` to include
the origin you serve the frontend from (the Vite dev server's `http://localhost:5173` by default).

For a production build: `npm run build` (outputs to `frontend-react/dist/`), served by any static
host (Plesk included) — client-side routing needs a rewrite-to-`index.html` fallback for unknown
paths, the same requirement any React Router SPA has.

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
