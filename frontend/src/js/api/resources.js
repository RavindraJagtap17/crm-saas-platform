import { api } from "./client.js";
import { qs } from "../components/ui.js";

export const authApi = {
  google: (idToken) => api.post("/api/auth/google", { idToken }),
  // Self-service Agency signup — the signing-up person's identity comes
  // from the Google ID token, never a form field; `fields` carries the
  // Agency's own business/KYC details (name, address, city, gstNumber,
  // mobile, contactEmail — all required, see agencySubscriptionValidators.
  // validateSignupAgency). "Agency pays per Client" restructure: Agency
  // signup is free — no checkout/payment step here at all, the new Agency
  // Admin lands straight on their console.
  signup: (idToken, fields) => api.post("/api/auth/signup", { idToken, ...fields }),
  me: () => api.get("/api/auth/me"),
  // Development-only — the backend route itself doesn't exist outside a
  // non-production NODE_ENV (see session.js's isDevBackend()); calling
  // this against a production backend simply 404s.
  devLogin: (role) => api.post("/api/auth/dev-login", { role }),
};

// Branding is agency-owned. GET is readable by every non-super_admin role
// (post-Phase-D fix: Client Admin/Employee display their owning agency's
// branding); PATCH stays agency_admin-only (backend-enforced).
export const tenantApi = {
  get: () => api.get("/api/tenant"),
  update: (body) => api.patch("/api/tenant", body),
};

// Agency Admin only — managing the agency's own clients, and (post-Phase-D
// ownership fix) that client's Custom Field definitions + read-only
// visibility into its lead sources/products for Website Form building.
export const clientsApi = {
  list: () => api.get("/api/clients"),
  get: (id) => api.get(`/api/clients/${id}`),
  create: (body) => api.post("/api/clients", body),
  setStatus: (id, status) => api.patch(`/api/clients/${id}/status`, { status }),
  inviteAdmin: (id, body) => api.post(`/api/clients/${id}/invite-admin`, body),
  // The plan-derived effective client limit — ALWAYS read from here, never
  // computed client-side. null = unlimited.
  limit: () => api.get("/api/clients/limit"),
  // "Agency pays per Client" restructure — create()'s response now also
  // carries `checkout` (null if Razorpay couldn't be reached at creation
  // time; renew() is the same underlying call, used to retry or to renew
  // an expired license).
  license: (id) => api.get(`/api/clients/${id}/license`),
  renewLicense: (id) => api.post(`/api/clients/${id}/license/renew`),
  customFields: {
    list: (clientId) => api.get(`/api/clients/${clientId}/custom-fields`),
    create: (clientId, body) => api.post(`/api/clients/${clientId}/custom-fields`, body),
    update: (clientId, fieldId, body) => api.patch(`/api/clients/${clientId}/custom-fields/${fieldId}`, body),
  },
  leadSources: (clientId) => api.get(`/api/clients/${clientId}/lead-sources`),
  products: (clientId) => api.get(`/api/clients/${clientId}/products`),
};

export const usersApi = {
  // Response includes `invitations` (pending) alongside `users` — no
  // employee-seat limit exists anymore, so there is nothing to report a
  // capacity summary against.
  list: () => api.get("/api/users"),
  invite: (body) => api.post("/api/users/invite", body),
  cancelInvitation: (id) => api.post(`/api/users/invitations/${id}/cancel`),
  setStatus: (id, status) => api.patch(`/api/users/${id}/status`, { status }),
};

export const leadsApi = {
  list: (query) => api.get(`/api/leads${qs(query)}`),
  get: (id) => api.get(`/api/leads/${id}`),
  create: (body) => api.post("/api/leads", body),
  update: (id, body) => api.patch(`/api/leads/${id}`, body),
  remove: (id) => api.delete(`/api/leads/${id}`),
  changeStatus: (id, statusId) => api.post(`/api/leads/${id}/status`, { statusId }),
  assign: (id, assignedTo) => api.post(`/api/leads/${id}/assign`, { assignedTo }),
  activities: (id) => api.get(`/api/leads/${id}/activities`),
  addActivity: (id, body) => api.post(`/api/leads/${id}/activities`, body),
  createFollowUp: (id, body) => api.post(`/api/leads/${id}/follow-ups`, body),
};

export const followUpsApi = {
  list: (query) => api.get(`/api/follow-ups${qs(query)}`),
  get: (id) => api.get(`/api/follow-ups/${id}`),
  update: (id, body) => api.patch(`/api/follow-ups/${id}`, body),
  complete: (id) => api.post(`/api/follow-ups/${id}/complete`),
  cancel: (id) => api.post(`/api/follow-ups/${id}/cancel`),
};

export const leadStatusesApi = {
  list: () => api.get("/api/lead-statuses"),
  create: (body) => api.post("/api/lead-statuses", body),
  update: (id, body) => api.patch(`/api/lead-statuses/${id}`, body),
};

export const leadSourcesApi = {
  list: () => api.get("/api/lead-sources"),
  create: (body) => api.post("/api/lead-sources", body),
  update: (id, body) => api.patch(`/api/lead-sources/${id}`, body),
};

export const productsApi = {
  list: (includeInactive) => api.get(`/api/products${qs({ includeInactive })}`),
  create: (body) => api.post("/api/products", body),
  update: (id, body) => api.patch(`/api/products/${id}`, body),
};

// Read-only from Client Admin/Employee — definitions are now managed by
// Agency Admin (see clientsApi.customFields). Client-side still needs
// this to render custom fields on the lead create/edit form and to show
// field labels for values already on a lead.
export const customFieldsApi = {
  list: () => api.get("/api/custom-fields"),
};

export const dashboardApi = {
  summary: () => api.get("/api/dashboard/summary"),
};

export const webFormsApi = {
  list: () => api.get("/api/web-forms"),
  create: (body) => api.post("/api/web-forms", body),
  update: (id, body) => api.patch(`/api/web-forms/${id}`, body),
  // Read-only — lets an Agency Admin see (never edit) a selected client's
  // active custom field definitions while building a form.
  clientCustomFields: (clientId) => api.get(`/api/web-forms/clients/${clientId}/custom-fields`),
};

export const metaApi = {
  connect: () => api.get("/api/meta/connect"),
  connection: () => api.get("/api/meta/connection"),
  updateConnection: (body) => api.patch("/api/meta/connection", body),
  disconnect: () => api.delete("/api/meta/connection"),
  forms: () => api.get("/api/meta/forms"),
  mappings: (formId) => api.get(`/api/meta/mappings${qs({ formId })}`),
  createMapping: (body) => api.post("/api/meta/mappings", body),
  updateMapping: (id, body) => api.patch(`/api/meta/mappings/${id}`, body),
  removeMapping: (id) => api.delete(`/api/meta/mappings/${id}`),
  capiEvents: () => api.get("/api/meta/capi/events"),
};

export const superAdminApi = {
  overview: () => api.get("/api/super-admin/overview"),
  // query: { q, status } — both optional, server-side filtered (see
  // tenantModel.listAll).
  listTenants: (query) => api.get(`/api/super-admin/tenants${qs(query)}`),
  getTenant: (id) => api.get(`/api/super-admin/tenants/${id}`),
  // Client license monitoring — verified server-side to belong to
  // tenantId (see superAdminService.getClient); a mismatched pair 404s.
  getClient: (tenantId, clientId) => api.get(`/api/super-admin/tenants/${tenantId}/clients/${clientId}`),
  // Manual escape hatch, separate from self-service Agency signup
  // (POST /api/auth/signup — see auth-signup.js): lets a Super Admin
  // create an agency directly and separately invite its first Agency
  // Admin, e.g. for support/onboarding cases that don't go through
  // self-service signup.
  createAgency: (name) => api.post("/api/super-admin/tenants", { name }),
  inviteAgencyAdmin: (id, body) => api.post(`/api/super-admin/tenants/${id}/invite-admin`, body),
  updateStatus: (id, status) => api.patch(`/api/super-admin/tenants/${id}/status`, { status }),
  // "Agency pays per Client" restructure: the ONE price an Agency pays per
  // Client added.
  getClientLicensePrice: () => api.get("/api/super-admin/client-license-price"),
  upsertClientLicensePrice: (body) => api.put("/api/super-admin/client-license-price", body),
};
