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

**Rate limiting (Step 10)**: `POST /api/auth/google` and `/api/auth/signup` are limited to 20
requests per 15 minutes per IP; `POST /api/auth/refresh` to 60 per 15 minutes per IP (higher,
since every open tab/page load calls it). Over the limit: `429 { "error": "..." }`. Mirrors the
same `express-rate-limit` pattern the public enquiry form (Step 6) already used.

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
  "user": { "id": 1, "email": "...", "name": "...", "avatarUrl": "...", "role": "tenant_admin", "tenantId": 1, "status": "active", "tenantStatus": "active" }
}
```
Also sets the `refresh_token` cookie. `tenantStatus` (Step 9) is `null` for a `super_admin` (who carries
no tenant) — a UX-only signal for the frontend; the actual gate is enforced server-side by
`requireActiveTenant`, not this field.

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
  As of Step 9 this is a **manual override of the raw tenant status only** — it does not touch
  Razorpay at all. It exists for a tenant that has no subscription yet (hasn't completed
  self-service signup/checkout); once a tenant has a real subscription, use the subscription-aware
  endpoints below instead, which keep Razorpay's own state and `tenants.status` consistent.

**Step 9 additions** — see the full "Razorpay Subscription Billing" section further down for
request/response detail:
- `GET/POST /plans`, `PATCH /plans/:id`, `PATCH /plans/:id/active` — local plan catalog management.
- `GET /tenants/:id/subscription`, `PATCH /tenants/:id/subscription/plan`,
  `POST /tenants/:id/subscription/{suspend,resume,cancel}` — any-tenant subscription override,
  built on the exact same service functions the Tenant Admin's own billing routes call.

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

## Meta Conversions API — CAPI (Step 8)

Sends one server-side conversion event, per lead, to the tenant's own Meta Pixel/Dataset — only
when that lead reaches a status the tenant has marked `is_final` (Lead Statuses admin page, Step
4). **Never** on lead creation, and never for a non-final status change. Builds on the Step 7
connection unchanged — same `meta_integration_settings` row, same encrypted token, same
`graphClient` module — this is not a second Meta connection.

### Configuration — Tenant Admin only, extends the Step 7 connection

| Route | Notes |
|---|---|
| `PATCH /api/meta/connection` | `{ "pixelId": "123456789012345" }`. Sets the Meta Pixel/Dataset ID conversion events are sent to. `400` if empty, or if there's no Meta connection yet to attach it to. Entered manually — Meta's OAuth data doesn't reliably expose a single "correct" pixel to auto-select (see migration `016_add_pixel_id_to_meta_integration_settings`). |
| `GET /api/meta/capi/events` | `{ "events": [{ "id": 1, "tenant_id": 4, "lead_id": 91, "event_name": "Lead", "meta_event_id": "crm_lead_4_91", "status": "sent", "retry_count": 0, "next_attempt_at": null, "last_error": null, "meta_response_code": "events_received:1", "sent_at": "...", "created_at": "..." }, ...] }` — the tenant's own recent conversion events only, most recent first. Minimum operational visibility (§K) — not an analytics dashboard: whether CAPI is usable, the latest delivery status, and enough failure detail to troubleshoot. |

### Trigger (§B)

`POST /api/leads/:id/status` (Step 4, unchanged route/behavior) is the only place this can fire
from. After the status write and its `lead_status_history` row land in the same transaction that
already existed, one more check runs *inside that same transaction*: is the **target** status
`is_final`? If not, nothing happens — no row, no event, not even a queued-then-skipped one. If it
is, exactly one `meta_capi_events` row is queued (or silently skipped if one already exists for
this lead — see Idempotency). This queuing is atomic with the status change; **sending** the event
to Meta is not — it happens afterward, asynchronously, so a slow or failing Meta call can never
delay, fail, or roll back the status-change response itself (§I).

### Event payload

```json
{
  "event_name": "Lead",
  "event_time": 1787745787,
  "event_id": "crm_lead_4_91",
  "action_source": "system_generated",
  "user_data": { "em": ["<sha256 hex>"], "ph": ["<sha256 hex>"] }
}
```
Sent as `POST https://graph.facebook.com/{version}/{pixelId}/events` with `access_token` in the
body (`graphClient.sendCapiEvent`). `event_name` is `"Lead"` — one of Meta's own standard events,
representing "this lead qualified," reported at the CRM's conversion moment rather than at Meta
Lead Ads submission time (which Step 7 already covers separately, on ingestion). `action_source`
is `"system_generated"` — the correct Meta value for a backend/pipeline-triggered event with no
browser context (no `fbc`/`fbp`/`client_ip`/`user_agent` fields exist to send, and none are
fabricated). `user_data.em`/`ph` are included only when the lead actually has that field — a lead
with neither email nor phone still sends (with an empty `user_data`), rather than being skipped;
Meta match quality suffers but the conversion signal itself isn't lost.

**Hashing (§D/§J)**: before hashing, email is trimmed and lowercased; phone is normalized to
digits-only via the *same* `normalizePhone()` Step 4 already uses for duplicate detection — no
second phone-cleaning implementation. Both are then SHA-256 hashed (hex digest). The raw value is
never sent to Meta and never stored — `meta_capi_events` has no email/phone columns at all.

### Credential resolution (§A/§E)

Strictly the target lead's own `tenant_id` → that tenant's `meta_integration_settings` row → its
`access_token_encrypted`, decrypted only at send time via the same
`metaIntegrationService.getDecryptedAccessToken()` Step 7 already built. Nothing here ever accepts
a `tenant_id` from client input — there's no client input on this path at all, since it only ever
fires from the server's own transaction. No tenant's event can ever use another tenant's
credentials because there is no code path that looks one up by anything other than the lead's own
resolved `tenant_id`.

### Idempotency (§H) — two independent layers, deliberately separate from phone-based duplicate detection

1. **We never queue a second event for the same lead.** `meta_capi_events` has a `UNIQUE
   (tenant_id, lead_id)` constraint; queuing goes through `INSERT IGNORE`. A lead re-entering a
   final status (re-applying the same status, or moving between two different final statuses)
   finds its existing row and queues nothing new.
2. **Meta itself also dedupes**, via the deterministic `event_id` (`crm_lead_{tenantId}_{leadId}`)
   sent with the event — protects against the case where we send successfully but crash before
   recording it, and a retry (or the startup sweep) attempts the same already-sent event again.

This is unrelated to **phone-based duplicate detection** (Step 4/6/7, `leads.is_duplicate`) — that
flags a *second lead* sharing a phone number as a probable business duplicate and still creates it.
CAPI idempotency instead guarantees a single *lead* can never generate more than one CAPI *send*,
regardless of how many times its status change is retried or its worker re-runs.

### Queue / worker behavior (§F)

`meta_capi_events` itself is the queue — `status` (`pending` → `processing` → `sent` /
`failed_temporary` / `failed_permanent`), `retry_count`, and `next_attempt_at` are what a worker
selects and claims against. There is no separate job-queue table, cron process, or external broker
(Redis, etc.) — `src/jobs/` was only ever an empty Step 1 scaffold, and standing up a general
job-queue system for exactly one job type would be exactly the "duplicate the entire job system
unnecessarily" the spec warns against. Instead:
- Right after a conversion is queued (post-commit), it's processed on the next event-loop tick
  (`setImmediate`) — no polling delay for the common case.
- On a transient failure, the retry is scheduled with `setTimeout` for as long as this process
  keeps running.
- On process start, `runStartupSweep()` (called from `server.js`) re-picks-up anything left
  `pending` or due for retry — recovering exactly what a restart would otherwise strand (a lost
  `setTimeout`, or an event queued right before a crash).

Claiming is atomic (`UPDATE ... WHERE status IN ('pending','failed_temporary') AND ...`) so the
immediate trigger, the startup sweep, and a manual reprocess can never double-send the same event.

### Retry behavior (§G)

Backoff: 1, 5, 15, 60, 240 minutes (5 attempts total) — `failed_temporary` between attempts,
`failed_permanent` once exhausted, with a message noting the max was reached. **Transient vs.
permanent** is read from Meta's own `error.is_transient` field when present, falling back to HTTP
status (`5xx`/`429` → transient; everything else, e.g. `400` validation or `401`/`403` auth → not
retried at all, since nothing about retrying fixes a bad credential or a rejected value). A missing
Meta connection, a missing Pixel ID, or an expired/revoked token are all classified as immediate
`failed_permanent` outcomes too, for the same reason — only a Tenant Admin action (reconnect,
configure a Pixel) can resolve any of them, so time-based retrying would never help.

### Failure isolation (§I)

The lead status change is committed in its own transaction, before any Meta API call is ever made.
Every one of these failure cases still leaves the status change fully intact: no Meta integration,
an expired/revoked token, a temporary Meta outage, or a permanent Meta validation error. CAPI
failure is recorded on the `meta_capi_events` row only — it cannot roll back, fail, or delay the
`POST /api/leads/:id/status` response, because sending happens strictly after that response's
transaction has already committed.

### Local testing without a real Meta App

Same approach as Step 7: only `graphClient.sendCapiEvent` (the true external boundary) was mocked;
everything else — the trigger logic, the transaction boundary, tenant/credential resolution,
hashing, retry/backoff state transitions, idempotency, and admin visibility — was exercised for
real against the local database and a running instance of this app.

## Razorpay Subscription Billing (Step 9)

Gates access to the CRM interior behind an active subscription. A tenant's Google Sign-In and
first Tenant Admin (Step 3) are unaffected — signup still works exactly as before; what's new is
that the resulting tenant now can't actually *use* the workspace until billing completes.

### Local plan catalog vs. Razorpay Plan

Two related but different things:

1. **`subscription_plans`** — this app's own catalog. Super Admin manages it entirely (create,
   edit price/name/features, activate/deactivate). Never talks to Razorpay.
2. **A Razorpay Plan** — created directly in the Razorpay Dashboard, not through this app.
   Razorpay Plans can't be edited or deleted once created, so this app never attempts to.

Every local plan references one Razorpay Plan via `razorpay_plan_id` — entered manually by Super
Admin when registering the local plan (mirroring the price/cycle they already set up on Razorpay's
side), the same way Step 8's Meta Pixel ID is entered rather than auto-discovered. `price` is
stored in the smallest currency unit (paise for INR), matching Razorpay's own `amount`
representation — never a float. Deactivating a local plan (`is_active: false`) only removes it
from what *new* subscribers can select; an existing subscriber on a since-deactivated plan is
completely unaffected until they're moved to a different plan through a normal plan-change.

### Tenant billing — Tenant Admin only, own tenant always

| Route | Notes |
|---|---|
| `GET /api/billing/plans` | Every **active** local plan. Reachable regardless of the tenant's own status — this is precisely how a `pending_payment` tenant sees what it can subscribe to. |
| `GET /api/billing/subscription` | `{ "subscription": {...} \| null, "plan": {...} \| null }` — the tenant's own current subscription (one row, always — §A) plus a plan summary so the UI doesn't need a second call. `null` before the tenant has ever subscribed. |
| `GET /api/billing/payments` | The tenant's own payment ledger, most recent first. |
| `POST /api/billing/subscribe` | `{ "planId": 3 }`. Only valid once — `409 SUBSCRIPTION_ALREADY_EXISTS` if a subscription already exists (regardless of its status; a plan **change** is a different endpoint). See the signup flow below. |
| `PATCH /api/billing/subscription/plan` | `{ "planId": 3, "timing": "now" \| "cycle_end" }`. §J — always the caller's own tenant (`req.tenantId` from the verified token; `tenant_id` is never accepted from the request body anywhere in this API). |

None of these five routes are gated by `requireActiveTenant` — they're precisely the "routes
required to complete billing" §I says must stay reachable no matter the tenant's status.

### Signup → Checkout → Webhook flow (§C)

```
Google Sign-In (Step 3, unchanged)
  → tenant created, status = pending_payment (unchanged default)
  → GET /api/billing/plans → tenant picks one
  → POST /api/billing/subscribe
      → backend resolves the LOCAL plan's razorpay_plan_id (never trusts a client-supplied one)
      → creates/reuses a Razorpay Customer (the signing admin's own name/email)
      → creates the Razorpay Subscription against that razorpay_plan_id
      → stores one local `subscriptions` row (status as Razorpay returned it, e.g. "created")
      → returns ONLY { razorpayKeyId, razorpaySubscriptionId, planName, amount, currency }
  → frontend opens Razorpay's own hosted Checkout (Checkout.js) with that subscription_id
      → Razorpay collects payment details directly — this backend never sees card data (§E)
  → Checkout's `handler` callback fires in the browser — NEVER trusted as activation (§G/§H);
    the frontend polls GET /api/billing/subscription until the status changes
  → Razorpay sends a signed webhook (subscription.authenticated, then .activated, ...)
  → ONLY once that webhook is verified does tenants.status become "active"
```

`razorpayKeyId` is Razorpay's own **public** key, meant to be visible to the browser (Checkout.js
is designed to run with it) — the matching `key_secret` never leaves this backend
(`razorpayClient.js`, Basic Auth on every outbound Razorpay call).

### Webhook — shared across every tenant, no authentication

`POST /api/razorpay/webhook` — same raw-body-capture and app.js exclusion pattern as Meta's
webhook (Step 7): `X-Razorpay-Signature` is an HMAC-SHA256 of the *exact raw request bytes* using
`RAZORPAY_WEBHOOK_SECRET` (a value you set when configuring the webhook itself — distinct from
`RAZORPAY_KEY_SECRET`), verified with `crypto.timingSafeEqual`. A missing/incorrect signature is
`403` and logged to `webhook_logs` (`source: "razorpay"`) — never processed further. There is no
GET handshake for Razorpay's webhook (unlike Meta's) — the URL and secret are simply entered once
in the Dashboard.

**Events actually handled, and why** (§F — deliberately not every event Razorpay can send):

| Event(s) | What happens |
|---|---|
| `subscription.authenticated`, `.activated`, `.charged`, `.completed`, `.updated`, `.pending`, `.halted`, `.paused`, `.resumed`, `.cancelled` | All handled by **one** reconciliation function: Razorpay's subscription entity always carries its own current `status`, which this schema's `subscriptions.status` ENUM mirrors verbatim — read directly rather than hand-mapping each event name. Also updates `subscriptions.plan_id` (only when `entity.plan_id` resolves to a known local plan) and `subscriptions.current_period_end`, and derives `tenants.status` from the reconciled subscription status (see mapping below). |
| `subscription.charged` (additionally) | Also carries a `payment` entity in the same payload — recorded into `payments` here rather than via a separate `payment.captured` handler, since Phase 1 has no non-subscription payment flow for that to apply to. |
| `payment.failed` | Recorded into `payments` (`status: "failed"`) for the ledger only — **never** changes `subscriptions.status` or `tenants.status` by itself (§L: a failed attempt can be followed by a successful retry; what governs access is the subscription's own status). |
| Anything else (`payment.authorized`, `refund.*`, `order.paid`, ...) | Acknowledged `200`, otherwise ignored — no local state this app tracks depends on them. |

**`subscriptions.status` → `tenants.status` mapping** (the only place `tenants.status` is written
once a tenant has a subscription at all):

| Razorpay subscription status | tenants.status |
|---|---|
| `active` | `active` |
| `cancelled`, `completed`, `expired` | `canceled` |
| `halted`, `paused` | `suspended` |
| `created`, `authenticated`, `pending` | `pending_payment` |

Authenticating (the mandate succeeding) is deliberately **not** enough to activate — only the
subscription's own `active` status is (§H: "do not activate if... webhook signature invalid,
payment/authorization failed, or subscription is not in an appropriate active state").

### Idempotency (§M) — two layers

1. **Event-level**: `razorpay_webhook_events.razorpay_event_id` is `UNIQUE`. Razorpay's
   `X-Razorpay-Event-Id` header stays identical across every retry of the *same* event (falls back
   to a derived `event:created_at:entityId` key in the rare case that header is absent). The
   idempotency-insert and every local state change it causes are committed in **one transaction**
   — if reconciliation throws partway through, the whole thing (including the idempotency marker)
   rolls back, so a Razorpay retry correctly reprocesses from scratch rather than being silently
   swallowed by a marker for work that never actually finished.
2. **Payment-level**: `payments.razorpay_payment_id` is separately `UNIQUE` (`INSERT IGNORE`) — a
   payment already recorded is never duplicated even if it somehow arrived via two different
   event deliveries.

### Failure handling (§N)

A genuine processing error (not a rejected signature, not an intentionally-ignored event type)
propagates past the controller and returns a non-2xx — deliberately **not** swallowed into a `200`
the way an individual failed entry is in Meta's batched webhook (Step 7): Razorpay delivers exactly
one event per request, so letting Razorpay's own retry mechanism try again later is the correct
behavior here, and the transactional rollback above guarantees that retry starts clean. A failed
Razorpay API call (subscription creation, plan change, pause, cancel) is never allowed to leave
partial local state — the local DB write only ever happens after the Razorpay call has already
succeeded (`subscribe()`), or the local `tenants.status` write only happens after a synchronous,
successful, backend-authenticated Razorpay API response (`suspend()`/`cancel()` — see below).

### Tenant subscription gating (§I)

`requireActiveTenant` middleware (`backend/src/middlewares/requireActiveTenant.js`) — re-reads the
tenant's current status from the database on every request (never trusts the access token's
claims, since this state can change authoritatively at any moment via webhook). Applied to every
CRM-interior route: leads, lead statuses/sources, products, custom fields, users, dashboard, web
forms, and the Meta Lead Ads/CAPI admin routes. **Not** applied to: `/api/auth/*`, `/api/billing/*`
(must stay reachable to let a blocked tenant fix it), `GET /api/tenant` (so the frontend can read
its own tenant's status to render the right screen), or any Super Admin route (§H: Super Admin is
never blocked by any tenant's subscription state — enforced by an explicit `role === "super_admin"`
bypass at the top of the middleware, not by omission).

### Super Admin override (§K)

`billingService.js`'s `getSubscriptionForTenant`/`changePlan`/`suspend`/`resume`/`cancel` are the
exact same functions the Tenant Admin's own routes call — only the route layer differs in which
`tenantId` it's allowed to pass in (`req.tenantId` from the token vs. `req.params.id`, Super Admin
only). `suspend`/`cancel` call Razorpay's real **pause**/**cancel** subscription actions, not a
local-only flag — a "suspended" tenant is genuinely not billed further, not just blocked from the
CRM while Razorpay keeps charging it. Unlike webhook-driven activation, these DO update
`tenants.status` immediately: the trigger is a synchronous, this-backend's-own-Basic-Auth-
authenticated Razorpay API response, not an unverified browser redirect — there's nothing further
to wait on the way there is for a checkout flow.

### Plan changes — immediate vs. end-of-cycle (§J)

`timing: "now"` or `timing: "cycle_end"` is chosen by the caller on every request — Razorpay's own
two supported values for `schedule_change_at`, nothing else invented (no proration, no custom
effective dates). **`subscriptions.plan_id` is never updated by the plan-change request itself,
regardless of which timing was chosen** — only a subsequent `subscription.updated` webhook,
carrying Razorpay's own confirmed `entity.plan_id`, ever writes it. This means even a `"now"`
request shows the OLD plan in `GET /api/billing/subscription` until Razorpay's webhook actually
confirms the switch — deliberately conservative, since the alternative (optimistically writing the
new plan_id for `"now"`) would violate §J's "do not claim a plan is immediately active" the moment
Razorpay's own processing takes even a few seconds.

### Local testing without a real Razorpay account

Same approach as Steps 7/8: only `razorpayClient.js`'s outbound calls (the true external boundary
— no real Razorpay Test Mode account exists in this sandboxed environment) were mocked; signature
verification, idempotency, tenant/plan resolution, the full activation/gating/reconciliation state
machine, and every failure path were all exercised for real against the local database and a
running instance of this app. A valid webhook signature can be generated locally with nothing more
than your own `RAZORPAY_WEBHOOK_SECRET`:
```bash
node -e "console.log(require('crypto').createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify({event:'subscription.activated',payload:{}})).digest('hex'))"
```
**Real Razorpay webhook delivery** requires a publicly reachable HTTPS endpoint (Razorpay cannot
reach `localhost`) — for genuine end-to-end testing against Razorpay Test Mode, expose the local
server through a secure tunnel (e.g. ngrok) or a staging deployment, and register that URL plus a
real webhook secret in the Razorpay Dashboard.

## Security hardening (Step 10)

Final pre-deployment audit across Steps 1–9 — no new business functionality, no schema redesign.
Two genuine issues were found and fixed:

1. **Cross-tenant lead hijack via `metaLeadId`** (fixed) — `POST /api/leads` silently accepted a
   client-supplied `metaLeadId`, even though it's listed as a protected field. Because
   `leads.meta_lead_id` has a platform-wide (not tenant-scoped) `UNIQUE` index — required for Step
   7's webhook idempotency to work at all — any authenticated tenant user could "pre-claim" another
   tenant's real Meta `leadgen_id` and silently swallow that lead when Meta's webhook later
   delivered it for real. Fixed in `leadService.js`'s `createLead`: `metaLeadId` is now only ever
   accepted from the one trusted internal caller (`actor.role === "meta_integration"`, a role no
   authenticated request can ever carry), not from request shape.
2. **No rate limiting on authentication endpoints** (fixed) — `/api/auth/google`, `/api/auth/signup`,
   and `/api/auth/refresh` had none, unlike the public enquiry form (Step 6). Added (see the
   Authentication section above).

Also hardened, non-behavioral: `payments.subscription_id` was a single-column FK to
`subscriptions(id)` rather than the composite `(tenant_id, id)` pattern every other tenant-owned
cross-reference in this schema uses — migrations 022–023 add the missing `(tenant_id, id)` key on
`subscriptions` and repoint the FK, so it's now structurally impossible (not just conventionally
unlikely) for a payment row to reference another tenant's subscription. Not exploitable today (the
only writer always derives both ids from the same already-tenant-scoped row) — closed as
defense-in-depth. Meta's and Razorpay's webhook endpoints also gained the same generous rate limit
(300/min/IP) applied to `/api/auth/*`'s pattern, guarding the one remaining "sensitive public
endpoint" category that had none.

A full tenant-isolation audit (every model/service query, all 10 attack scenarios from the Step 10
spec — cross-tenant lead/Meta/subscription/branding access, privilege escalation) found no other
issues. See the Step 10 report (delivered in chat, not a file) for the complete findings list,
regression results, and Final Phase 1 acceptance checklist.

## Everything else

Any other path currently returns `404`:

```json
{ "error": "Not found: GET /whatever" }
```

No WhatsApp, YaGo, or other later-phase routes exist yet.
