# API Reference

This file tracks only what actually exists in the codebase right now. It will grow as each step
adds real endpoints — see Section 22 of the Final Specification for the complete, final API
surface this is building toward.

Base URL (local): `http://localhost:4000`

## GET /health

Confirms the API process is up. No authentication required.

**Request**

```
GET /health
```

**Response — 200 OK**

```json
{
  "status": "ok",
  "uptime": 12.345,
  "timestamp": "2026-08-25T12:00:00.000Z"
}
```

## Error responses

Every error is `{ "error": "human-readable message" }`. When the app raised the error on purpose
for a condition a client might want to branch on (not a generic 500), it also includes a stable
`"code"` — e.g. `ACCOUNT_NOT_FOUND`, `EMPLOYEE_LIMIT_REACHED`. Codes are never present on an
unexpected `500`, only on errors the app explicitly identified.

## Authentication (Step 3)

Google Sign-In is the only identity provider — there is no password field or password-reset flow
anywhere in this API. All request/response bodies below are JSON.

Refresh tokens travel as an `httpOnly` cookie (`refresh_token`, scoped to path `/api/auth`), not in
the response body — a client-side script can never read it, which is the point. Callers that need
the refresh flow to work must send credentials (e.g. `fetch(url, { credentials: "include" })`).

### POST /api/auth/google

Normal sign-in for an account that already exists (active or invited).

**Request**
```json
{ "idToken": "<Google ID token from Google Identity Services>" }
```

**Response — 200 OK**
```json
{
  "accessToken": "<JWT, ~15 min>",
  "user": { "id": 1, "email": "...", "name": "...", "avatarUrl": "...", "role": "tenant_admin", "tenantId": 1, "status": "active" }
}
```
Also sets the `refresh_token` cookie.

**Errors**
- `400` — missing/malformed token
- `401` — invalid/expired Google token, or unverified Google email
- `404` — no account exists for this email (`code: "ACCOUNT_NOT_FOUND"`) — normal sign-in never auto-creates an account
- `403` — account has been deactivated

### POST /api/auth/signup

"Create your agency" — only valid when no account exists yet for this email. Creates a new tenant
(`status: "pending_payment"`, `employee_limit: 3`) and its first Tenant Admin, transactionally.
Does **not** touch Razorpay or activate the tenant — that's a later step.

**Request**
```json
{ "idToken": "<Google ID token>", "agencyName": "Acme Leads Co" }
```

**Response — 201 Created** — same shape as `/google`, `user.role` is `"tenant_admin"`.

**Errors** — `400` missing agency name / bad token, `401` invalid Google token, `409` an account already exists for this email (`code: "ACCOUNT_EXISTS"`).

### POST /api/auth/refresh

Rotates the refresh token (reads it from the cookie, not the body) and issues a new access token.
Presenting a refresh token that was already rotated out revokes **every** session for that user, on
the assumption it may have been stolen.

**Response — 200 OK** — same shape as `/google`. Sets a new `refresh_token` cookie.
**Errors** — `401` missing/invalid/expired/already-used refresh token.

### POST /api/auth/logout

Revokes the current refresh token and clears the cookie. **204 No Content.**

### GET /api/auth/me
_Requires `Authorization: Bearer <accessToken>`._

**Response — 200 OK**
```json
{ "user": { "id": 1, "email": "...", "name": "...", "avatarUrl": "...", "role": "tenant_admin", "tenantId": 1, "status": "active" } }
```
**Errors** — `401` missing/invalid/expired access token.

### Role-check test endpoints

Minimal endpoints that exist only to verify the authentication/authorization middleware — not
real CRM functionality. All require `Authorization: Bearer <accessToken>` and return
`{ "ok": true, "role": "...", "tenantId": ... }` on success, or `403` if the caller's role isn't allowed.

| Route | Allowed roles |
|---|---|
| `GET /api/auth/test-role/super-admin` | `super_admin` only |
| `GET /api/auth/test-role/tenant-admin` | `tenant_admin` only |
| `GET /api/auth/test-role/employee` | `tenant_employee` only |
| `GET /api/auth/test-role/shared` | `tenant_admin` or `tenant_employee` |

## Leads and lead configuration (Step 4)

Every route below requires `Authorization: Bearer <accessToken>` and is scoped to the caller's
tenant from that token — never from the request body, URL, or query string. **Super Admin cannot
access any of these routes** — leads are not part of the platform-level role's job (§B/§L).

**Role behavior, in one place:** Tenant Admin has full access to every lead, status, source,
product, and custom field in their tenant. Tenant Employee can create leads, but can only read/
update/add activity to leads *assigned to them*, can only update the status of their own assigned
leads, cannot assign/reassign anyone's leads, and cannot manage statuses/sources/products/custom
fields (read-only there). A lead outside an employee's scope returns `404`, not `403` — this is
deliberate, so a response can never be used to confirm a lead exists that the caller isn't allowed
to see.

Server-controlled fields (`tenantId`, `isDuplicate`, `duplicateOfLeadId`, `statusId`, `assignedTo`,
`createdAt`, `updatedAt`, …) are silently stripped from any lead create/update body — they can only
ever be set the way this document describes.

### Leads

| Route | Roles | Notes |
|---|---|---|
| `POST /api/leads` | Admin, Employee | Manual creation. See below. |
| `GET /api/leads` | Admin, Employee | Paginated list — Employee sees only their assigned leads. |
| `GET /api/leads/:id` | Admin, Employee | `404` if outside caller's scope. |
| `PATCH` / `PUT /api/leads/:id` | Admin, Employee | Updates `name`, `phone`, `email`, `sourceId`, `productId`, `customFields` only. |
| `DELETE /api/leads/:id` | Admin only | `409` if another lead references this one as its duplicate original. |
| `POST /api/leads/:id/status` | Admin, Employee | Status changes always go through here, never the generic PATCH — see below. |
| `POST /api/leads/:id/assign` | Admin only | Assign/reassign — see below. |
| `GET /api/leads/:id/activities` | Admin, Employee | |
| `POST /api/leads/:id/activities` | Admin, Employee | `type` must be `"call"` or `"note"` — `"assignment"` activities are only ever server-generated. |

**`POST /api/leads` request body**
```json
{
  "name": "Jane Doe",
  "phone": "+91 98765 43210",
  "email": "jane@example.com",
  "sourceId": 3,
  "productId": 7,
  "customFields": { "budget": "High" }
}
```
All fields optional except that at least one of `name`/`phone`/`email` must be present. If
`sourceId` is omitted, the lead is filed under the tenant's own "Manual" source, created
automatically on first use. The lead always starts with `statusId: null` and `assignedTo: null`.

**`GET /api/leads` query params** — `page` (default 1), `pageSize` (default 20, max 100, both
clamped rather than rejected if malformed), `q` (substring match against name/phone/email, added
in Step 5 for the lead list's search box), `statusId`, `sourceId`, `productId`, `assignedTo`
(Admin only), `isDuplicate` (`true`/`false`).

**Duplicate detection** (§H) runs on every creation: the phone number is normalized (digits only)
and checked against existing leads **in the same tenant only**. A match never blocks creation — the
new lead is created with `isDuplicate: true` and `duplicateOfLeadId` pointing at the earliest
match; both fields are always present in the response so a future UI can show an indicator.

**`POST /api/leads/:id/status`** — body `{ "statusId": 5 }`. Updates `leads.status_id` and writes a
`lead_status_history` row in the same transaction (no Meta CAPI triggering yet — later step).

**`POST /api/leads/:id/assign`** — body `{ "assignedTo": 12 }` (or `null` to unassign). The target
must be an **active** Tenant Admin or Tenant Employee in the *same* tenant. Writes an
`assignment`-type `lead_activities` row in the same transaction.

### Lead statuses — `GET/POST /api/lead-statuses`, `PATCH /api/lead-statuses/:id`
Admin: create/edit (`name`, `color` as `#RRGGBB`, `sortOrder`, `isFinal`). Employee: read only.
No delete endpoint (matches the approved spec — deactivation isn't defined for statuses either;
none is invented here). "Reorder" is done by `PATCH`-ing `sortOrder` on each status.

### Lead sources — `GET/POST /api/lead-sources`, `PATCH /api/lead-sources/:id`
Admin: create/edit (`name`, `type`). Employee: read only.

### Products — `GET/POST /api/products`, `PATCH /api/products/:id`
Admin: create/edit/enable-disable (`name`, `description`, `isActive`). Employee: read (active only,
unless `?includeInactive=true` — ignored for non-admins).

### Custom fields — `GET/POST /api/custom-fields`, `PATCH /api/custom-fields/:id`
Admin only for write. `fieldType` is one of `text`, `select`, `number`, `date`, `textarea` — there
is no file/upload type, and none can be requested (server validates against this exact allowlist).
`select` requires a non-empty `options` array of strings. `fieldKey` and `fieldType` cannot be
changed after creation — only `label`, `options` (select only), and `isActive`.

## Tenant, employees, and dashboard (Step 5)

These four small additions exist because the Step 5 UI genuinely had nothing to call without
them — Steps 1–4 built auth and the lead engine, but never tenant branding, employee invitation,
Super Admin tenant management, or dashboard aggregates. Each reuses only tables that already
existed (`tenants`, `users`, `leads` and friends) — no schema changes.

### GET / PATCH /api/tenant
_Admin, Employee (read) · Admin only (write)._ The caller's own tenant only — never another one.

```json
{ "tenant": { "id": 1, "name": "Acme Leads", "slug": "acme-leads", "status": "active", "employeeLimit": 3, "logoUrl": null, "brandPrimaryColor": "#4f46e5" } }
```
`PATCH` body: any of `name`, `logoUrl`, `brandPrimaryColor` (`#RRGGBB`). Logo is a hosted image URL
— there is no file upload in Phase 1.

### GET /api/users, POST /api/users/invite, PATCH /api/users/:id/status
_Admin only._ Team management **and** the source of the assignment dropdown on the leads UI.

`POST /api/users/invite` body: `{ "email": "...", "name": "...", "role": "tenant_admin" | "tenant_employee" }`.
Creates a `status: "invited"` user — no password, no email sent (that's a documented open question,
not this endpoint's job). Enforces the tenant's `employeeLimit` **only** against `tenant_employee`
role invites (invited + active count as used seats) — additional Admin accounts don't count against
it. Returns `409 EMPLOYEE_LIMIT_REACHED` when full.

`PATCH /api/users/:id/status` body: `{ "status": "active" | "deactivated" }` — the deactivate/
reactivate toggle.

### GET /api/dashboard/summary
_Admin, Employee._ Shape depends on the caller's role — Admin gets the tenant-wide view (§E), Employee gets only their own numbers.

```json
// Admin
{ "scope": "tenant", "totals": { "total": 42, "unassigned": 5, "duplicates": 2 },
  "sourceBreakdown": [{ "sourceId": 1, "name": "Manual", "count": 30 }],
  "monthlyVolume": [{ "month": "2026-08", "count": 12 }],
  "statusBreakdown": [{ "statusId": 1, "name": "New", "isFinal": false, "count": 10 }] }

// Employee
{ "scope": "employee", "totals": { "assigned": 6, "callsThisMonth": 14 },
  "statusBreakdown": [ /* same shape, scoped to their own leads */ ] }
```

### Super Admin — GET /api/super-admin/overview, /tenants, /tenants/:id, PATCH .../employee-limit, .../status
_Super Admin only — the one namespace where `tenantId` is deliberately `null` and routes operate
across every tenant._

- `GET /overview` — `{ totalTenants, totalUsers, totalLeads, tenantsByStatus: { active: 3, ... } }`.
- `GET /tenants` — every tenant, platform-wide.
- `GET /tenants/:id` — one tenant plus `employeeSeatsUsed` and its `users` list.
- `PATCH /tenants/:id/employee-limit` — body `{ "employeeLimit": 10 }`.
- `PATCH /tenants/:id/status` — body `{ "status": "pending_payment" | "active" | "suspended" | "canceled" }`.
  This **is** the "suspend/cancel subscription" capability from §B — there's no `subscriptions`
  table or Razorpay integration yet, so `tenants.status` (which already gates workspace access) is
  the only thing to suspend/cancel against right now.

## Everything else

Any other path currently returns `404`:

```json
{ "error": "Not found: GET /whatever" }
```

No Meta, Meta CAPI, Razorpay, or website-enquiry-form routes exist yet.
