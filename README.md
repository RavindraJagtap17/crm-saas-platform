# CRM Phase 1

Multi-tenant, white-labeled SaaS CRM for lead and client management — Meta Lead Ads, a universal
website enquiry form, Meta Conversions API, and Razorpay subscription billing.

The single source of truth for architecture and requirements is the approved
**CRM Phase 1 Final Specification**. This repository implements it incrementally, one approved
step at a time.

## Status

**Step 1 — Project & environment scaffold: complete.**
Nothing beyond the basic Express app and folder structure is implemented yet — no database, no
authentication, no leads, no integrations. See `docs/API.md` for exactly what exists today.

## Tech stack

- Frontend: HTML5, CSS3, vanilla JavaScript (no framework)
- Backend: Node.js, Express.js
- Database: MySQL (not yet connected — added in a later step)
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
npm run dev
```

The API starts on `http://localhost:4000` by default. Confirm it's running:

```bash
curl http://localhost:4000/health
```

## Documentation

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — target Plesk deployment approach
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — environment variables, what's active vs. reserved
- [`docs/API.md`](docs/API.md) — current API endpoints
