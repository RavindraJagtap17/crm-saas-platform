# Deployment (target: Plesk)

This describes the deployment approach the scaffold is built to support (Section 25 of the Final
Specification). **Nothing in this file has been executed yet** — no server has been provisioned
or configured. It exists now so the codebase is written in a way that won't need restructuring
when deployment actually happens.

## Target layout

- **Backend** — registered as a Node.js application in Plesk's Node.js extension (Phusion
  Passenger), pointed at `backend/src/server.js`. Plesk manages the process lifecycle (restart on
  crash, restart on server reboot).
- **Frontend** — served as a Plesk-managed static webspace/subdomain (e.g. `app.yourdomain.com`).
- **API** — its own subdomain (e.g. `api.yourdomain.com`), matching `CORS_ALLOWED_ORIGINS`.
- **Database** — a MySQL database and user created through Plesk's Databases panel; credentials
  passed to the app via environment variables only, never hard-coded.
- **TLS** — Plesk's built-in Let's Encrypt integration, one certificate per (sub)domain in use.
- **Backups** — the hosting owner's responsibility via Plesk's backup manager. Not implemented by
  this application.

## What the scaffold already does to stay deployment-ready

- No hard-coded URLs, ports, or file paths anywhere in the code — everything comes from
  environment variables (`backend/.env.example`, `docs/ENVIRONMENT.md`).
- `GET /health` exists for Plesk/Passenger to monitor process health.
- The server shuts down gracefully on `SIGTERM`/`SIGINT`, which is how Passenger stops a process
  on restart/deploy.
- Frontend and backend are fully separate folders that can be pointed at separate Plesk
  domains/subdomains without any code changes.

## Not yet done

Actual provisioning — creating the Plesk Node.js application, the database, DNS, and TLS
certificates — happens once the application has enough functionality to be worth deploying.
This file will be filled in with exact steps at that point.
