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

## Website enquiry form (Step 6)

Two audiences, two different sets of rules.

### Admin: managing forms — GET/POST /api/web-forms, PATCH /api/web-forms/:id
_Tenant Admin only_ — same pattern as statuses/sources/products.

```json
// POST /api/web-forms
{ "name": "Homepage Contact Form", "sourceId": 3, "productId": 7, "allowedDomains": ["example.com", "www.example.com"] }
```
`sourceId` is required (which of the tenant's own lead sources this form's submissions are tagged
with); `productId` is optional; `allowedDomains` is optional at creation (defaults to `[]`) —
bare hostnames only, no `https://` or path. The response includes a generated `formKey` (32
random hex characters) — this is the public, opaque identifier embedded on the tenant's website;
it is never derived from or exposed alongside the tenant's id.

### Public: the form itself — no authentication, reachable from any origin

**`GET /api/public/lead-form/:formKey`** — returns just enough to render the form: the form's
name and a `fields` array (the 3 core fields plus the tenant's active custom field definitions,
each with `key`/`label`/`type`/`options`). No tenant id, no internal source/product ids, no
account details.

**`POST /api/public/lead-form/:formKey/submit`** — creates a lead through the same
`leadService.createLead` used everywhere else in the app (§H of the spec): same phone
normalization, same duplicate detection scoped to that tenant only, same custom-field validation
against that tenant's own definitions, same "starts unassigned" rule. `tenantId`, `sourceId`,
`productId`, `statusId`, `assignedTo` — anything in the request body — are never read; the tenant,
source, and product always come from the resolved form, never the caller.

```json
// Request
{ "name": "Jane Doe", "phone": "+91 98765 43210", "email": "jane@example.com",
  "customFields": { "budget": "High" }, "hp_company_website": "" }

// Response — 201 (always this shape, honeypot-triggered or not — see below)
{ "success": true, "message": "Thanks — we'll be in touch shortly." }
```

An unknown, malformed, or inactive `formKey` returns `404` on both routes — deliberately
indistinguishable from each other, so a response can't be used to probe which formKeys exist.

**Honeypot** — the hidden field is named `hp_company_website` (a literal shared by convention
between `backend/src/services/publicFormService.js` and the two embed clients — deliberately not
exposed via the public config response). If it's non-empty, the response is **exactly the same
201 success shape** as a real submission — no lead is created, but nothing about the response
reveals that detection happened.

**Rate limiting** — 10 submissions per IP per 10-minute window on the `/submit` route (not the
config `GET`). Over the limit: `429 { "error": "Too many submissions from this network. Please
try again later." }`.

**Domain allowlist / Origin handling** — see the doc comment in
`backend/src/middlewares/checkFormOrigin.js` for the full reasoning; summarized:
- Script embed: `Origin` is the host page's own origin (the widget's `fetch()` runs in that
  page's context) — checked against that form's `allowedDomains`.
- Iframe embed: the form page is served from **this app's own origin**, so its `fetch()` always
  carries Origin = this app's frontend URL, regardless of which site iframes it — that specific
  origin is trusted directly rather than checked against `allowedDomains`, since Origin
  structurally cannot reveal the parent page's domain from inside an iframe. The formKey being a
  random, non-public 32-character value is the real access control for iframe usage.
- **Local/direct testing**: browsers are the only clients that send `Origin`/`Referer`
  automatically. Outside production (`NODE_ENV=development` or unset), a request with neither
  header is allowed through to the rest of the checks — this is what makes `curl`/Postman/local
  testing possible without a browser. In production, a request with neither header is rejected
  (`403 ORIGIN_REQUIRED`) — a genuine browser submission, script or iframe, always sends one.

### Embedding

**Script (primary)** — self-contained, dependency-free, renders into a Shadow DOM so host-site
CSS can't reach in or leak out:
```html
<script
  src="https://app.yourdomain.com/public/embed/crm-lead-widget.js"
  data-form-key="FORM_KEY"
  data-api-base="https://api.yourdomain.com"
></script>
```
`data-api-base` is required whenever the frontend and API are on different origins (the normal
case for this project — see `docs/DEPLOYMENT.md`); without it the widget assumes the API shares
its own script's origin, which is usually wrong. The exact tag to paste — with both values already
filled in — is generated on the tenant's **Website Forms** admin page.

**Iframe (fallback)**:
```html
<iframe
  src="https://app.yourdomain.com/public/embed/lead-form.html?formKey=FORM_KEY"
  width="100%" height="520" style="border:0"
></iframe>
```

## Meta Lead Ads (Step 7)

A tenant-scoped Meta connection (**not** one shared Meta account for every tenant) plus a single
shared inbound webhook. Only "see connected forms and configure field mapping" is in scope here —
this is not a Meta campaign/ad-management interface, and there is no Meta CAPI, WhatsApp, or
Google Ads integration anywhere in this codebase yet.

### Connection — Tenant Admin only

| Route | Notes |
|---|---|
| `GET /api/meta/connect` | Returns `{ "authorizationUrl": "https://www.facebook.com/v19.0/dialog/oauth?..." }` for the frontend to navigate the browser to. Never redirects itself — the caller's Bearer token stays in the `Authorization` header for this one call rather than being put in a URL. |
| `GET /api/meta/oauth/callback` | **Public** — this is where Meta redirects the browser after the tenant admin authorizes. Not callable meaningfully on its own; see OAuth flow below. |
| `GET /api/meta/connection` | `{ "connected": true, "pageId": "...", "pageName": "...", "adAccountId": "...", "tokenExpiresAt": "2026-10-20T00:00:00.000Z", "isExpired": false, "connectedAt": "..." }`, or `{ "connected": false }`. **Never** includes the access token, encrypted or otherwise. |
| `DELETE /api/meta/connection` | Removes the tenant's connection. `204`. New leads stop being imported; existing leads and field mappings are untouched. |
| `GET /api/meta/forms` | `{ "forms": [{ "id": "...", "name": "...", "status": "ACTIVE" }] }` — the connected Page's Lead Ads forms, fetched live from Meta. `400 META_NOT_CONNECTED` / `META_TOKEN_EXPIRED` if there's no live connection. |

**OAuth flow**: `beginConnect` signs a short-lived (10 min) JWT `state` param — `{ tenantId,
adminUserId, purpose: "meta_oauth" }`, using the same `JWT_ACCESS_SECRET` already used for access
tokens rather than standing up separate server-side session storage — and builds the standard Meta
OAuth dialog URL with it (`scope=pages_show_list,leads_retrieval,pages_manage_metadata,
pages_read_engagement`). When Meta redirects back to `oauthCallback`, the `state` is verified,
the code is exchanged for a short-lived then long-lived user token, the account's Pages are
listed, and **the first Page returned is connected automatically** — this is a deliberate Phase 1
simplification (see Assumptions in the Step 7 report), not a page-picker UI, since the spec calls
for only what's necessary for lead ingestion. The Page's own access token is what actually gets
encrypted and stored — leads are always fetched with a Page token, never the user token. Ad
account access is fetched best-effort and never blocks the connection if it fails. The browser is
then redirected to `{FRONTEND_URL}/public/admin/meta-integration.html?connected=true` (or
`?error=...`), since a server-to-browser redirect is the only channel this callback has back to
the frontend.

**Reconnecting a Page already connected to a different tenant** fails with `409
META_PAGE_ALREADY_CONNECTED` — enforced by a database `UNIQUE` constraint on `page_id`
(`meta_integration_settings`), which is also exactly what makes webhook tenant resolution
unambiguous by construction (see below).

**Token expiry**: `isExpired` is computed from `token_expires_at` (`null` means Meta reported no
fixed expiry — treated as not expired). There is **no automatic token refresh** — Meta's Page
token model (derived from a long-lived user token, itself only refreshable by the user
re-authorizing) doesn't offer a standard refresh-token grant to build one on top of, and the spec
explicitly says not to build this unless the OAuth flow requires/supports it. An expired
connection is surfaced via `isExpired` for the admin UI to show a "reconnect" warning; ingestion
for that tenant fails safely (see webhook behavior below) until the tenant admin reconnects.

### Field mapping — Tenant Admin only

| Route | Notes |
|---|---|
| `GET /api/meta/mappings?formId=...` | Lists the tenant's mappings, optionally filtered to one Meta form. |
| `POST /api/meta/mappings` | `{ "metaFormId": "...", "metaFieldKey": "full_name", "crmFieldKey": "name" }`. `409` if this exact form+field is already mapped. |
| `PATCH /api/meta/mappings/:id` | `{ "crmFieldKey": "..." }` — only the target can change; `metaFormId`/`metaFieldKey` are fixed after creation. |
| `DELETE /api/meta/mappings/:id` | |

`crmFieldKey` must be one of the three fixed core keys (`name`, `phone`, `email`) or an **active**
custom field definition for that tenant — `400 INVALID_CRM_FIELD_KEY` otherwise. This is checked
at mapping-save time, not hoped for at ingestion time, so a tenant admin gets immediate feedback
rather than a silently-dropped field later. All four routes are strictly `tenant_id`-scoped, both
in the `WHERE` clause of every query and via the `(tenant_id, id)` lookup on update/delete — a
mapping id belonging to another tenant returns a plain `404`, never a `403` that would confirm the
id exists.

### Webhook — shared across every tenant, no authentication

| Route | Notes |
|---|---|
| `GET /api/meta/webhook` | Meta's one-time subscription verification handshake (done once, in the App Dashboard). Echoes `hub.challenge` as `text/plain` if `hub.verify_token` matches `META_WEBHOOK_VERIFY_TOKEN`; `403` otherwise. |
| `POST /api/meta/webhook` | The real inbound event delivery. |

**Signature verification**: every `POST` must carry a valid `X-Hub-Signature-256: sha256=<hex>`
header — an HMAC-SHA256 of the *exact raw request bytes* using `META_APP_SECRET`, compared with
`crypto.timingSafeEqual`. This route captures the raw body itself (`express.json({ verify })`) and
is excluded from the app's global body parser and CORS middleware (`backend/src/app.js`) so that
raw-byte capture actually happens before anything else touches the body — parsing it first (even
just to validate JSON shape) would make the signature unverifiable, since whitespace/key-order
differences change the hash. A missing or incorrect signature is rejected with `403` and logged to
`webhook_logs` (`signature_valid: false`) — never processed further.

**Tenant resolution (§D)** — the *only* place a webhook event's tenant is ever determined:
`value.page_id` (falling back to `entry.id`) is looked up against `meta_integration_settings.page_id`.
Nothing else — not a `tenant_id` in the payload, not a query param, not a header — is ever trusted
for this. An unresolvable `page_id` returns outcome `unknown_page`, is logged with `tenant_id:
NULL` (never a default/global tenant), and creates no lead.

**Processing, per `leadgen` change in the payload** (a single `POST` can carry multiple
`entry[]`/`changes[]` items, potentially spanning several tenants' pages — each is resolved and
processed independently, and one bad or unresolvable entry never fails the rest of the batch):

1. Resolve tenant by `page_id` → `unknown_page` if none.
2. **Idempotency pre-check**: if a lead with this exact `meta_lead_id` already exists, outcome is
   `already_processed` — no Graph API call, no second lead. Backstopped by a genuine database
   `UNIQUE` constraint (`leads.meta_lead_id`, from Step 2) that also catches the race window
   between this check and the insert (a concurrent duplicate delivery hits `ER_DUP_ENTRY` and is
   caught as `already_processed` too). **This is deliberately separate from phone-based duplicate
   detection** (below) — idempotency exists so retried/duplicate *webhook deliveries* of the same
   Meta lead never create a second CRM record at all; phone-based dedup is a *business* signal that
   still creates the (second) lead, just flagged.
3. If the tenant's token is expired, outcome is `token_expired` — the Graph API is never called.
4. Fetch the full lead (`id, form_id, field_data, created_time, ad_id, page_id`) from Meta's Graph
   API using **that tenant's own decrypted Page access token** — never another tenant's, never a
   shared/global credential.
5. Apply this tenant+form's field mappings to `field_data`: mapped core fields (`name`/`phone`/
   `email`) go straight onto the lead; mapped custom fields go into `leads.custom_fields`; **any
   unmapped Meta field is dropped, not stored** — logged for visibility, never silently retained
   anywhere on the lead.
6. Create the lead through **the same `leadService.createLead()`** every other lead-creation path
   in this app uses (manual entry, the Step 6 website form, and now this) — same phone
   normalization, same tenant-scoped phone-based duplicate detection, same custom-field validation,
   same "starts unassigned, no status" rule. Source is the tenant's own auto-provisioned "Meta Ads"
   lead source (created lazily on first use, same pattern as "Manual" and the website form's
   sources). `meta_lead_id` is set so future retries hit the idempotency check above.

The endpoint always responds `200` once the signature itself is valid, regardless of individual
event outcomes (`created`, `already_processed`, `unknown_page`, `token_expired`,
`graph_api_error`, `malformed_event`) — every one of those is "nothing more to do", not a reason
for Meta to retry delivery. Every event (valid or rejected) is logged to `webhook_logs` for
debugging, including its outcome and resolved `tenant_id` where applicable — payloads are logged,
access tokens never are.

### Local testing without a real Meta App

Signature verification, tenant resolution, idempotency, field mapping, and lead creation were all
verified for real against the local database and a running instance of this app — only the true
external boundary (`graph.facebook.com`) was mocked, at the `graphClient` module level, since this
environment has no real Meta App/credentials (same situation as `GOOGLE_CLIENT_ID` in Step 3). A
valid webhook signature can be generated locally without any Meta account at all, since it only
needs your own `META_APP_SECRET`:
```bash
node -e "console.log('sha256=' + require('crypto').createHmac('sha256', process.env.META_APP_SECRET).update(JSON.stringify({entry:[]})).digest('hex'))"
```
The GET verification handshake can be exercised directly too:
```bash
curl "http://localhost:4000/api/meta/webhook?hub.mode=subscribe&hub.verify_token=YOUR_META_WEBHOOK_VERIFY_TOKEN&hub.challenge=test123"
```

## Everything else

Any other path currently returns `404`:

```json
{ "error": "Not found: GET /whatever" }
```

No Meta CAPI, Razorpay, WhatsApp, YaGo, or other later-phase routes exist yet.
