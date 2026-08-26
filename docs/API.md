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

## Everything else

Any other path currently returns `404`:

```json
{ "error": "Not found: GET /whatever" }
```

This is expected — no CRM business endpoints exist yet (Step 3 is authentication/tenant-scoping only).
