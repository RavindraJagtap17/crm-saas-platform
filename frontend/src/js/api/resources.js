import { api } from "./client.js";
import { qs } from "../components/ui.js";

export const authApi = {
  google: (idToken) => api.post("/api/auth/google", { idToken }),
  // Self-service Agency signup (finalized business model) — the signing-up
  // person's identity comes from the Google ID token, never a form field;
  // `name` here is the AGENCY's name. checkout in the response is null
  // when Razorpay couldn't be reached at signup time (see auth.controller.js);
  // either way the new Agency Admin lands on their own Billing page (via
  // shell.js's blocked-redirect, since a fresh agency starts pending_payment)
  // to complete or resume payment — this call never opens Checkout itself.
  signup: (idToken, name) => api.post("/api/auth/signup", { idToken, name }),
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
  customFields: {
    list: (clientId) => api.get(`/api/clients/${clientId}/custom-fields`),
    create: (clientId, body) => api.post(`/api/clients/${clientId}/custom-fields`, body),
    update: (clientId, fieldId, body) => api.patch(`/api/clients/${clientId}/custom-fields/${fieldId}`, body),
  },
  leadSources: (clientId) => api.get(`/api/clients/${clientId}/lead-sources`),
  products: (clientId) => api.get(`/api/clients/${clientId}/products`),
};

export const usersApi = {
  // Step 11A: response now also includes `invitations` (pending) and
  // `seatUsage` (informational — backend remains authoritative).
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

// Agency Admin only — managing the agency's own Client plan catalog
// (price/billing cycle/employee limit/active state). No Client-facing
// read endpoint exists yet — Client subscription work is a later step.
// Client Admin/Employee — the Client's own subscription to its Agency's
// plans. list/get are readable by both roles; choose/cancel are
// client_admin only (enforced server-side too — see clientBilling.routes.js).
// No payment/checkout call exists yet — see clientBillingService.js's
// header comment for the exact Razorpay verification boundary.
export const clientBillingApi = {
  plans: () => api.get("/api/client-billing/plans"),
  subscription: () => api.get("/api/client-billing/subscription"),
  choose: (planId) => api.post("/api/client-billing/subscription", { planId }),
  retry: () => api.post("/api/client-billing/subscription/retry"),
  payRenewal: () => api.post("/api/client-billing/subscription/pay-renewal"),
  downgrade: (planId) => api.post("/api/client-billing/subscription/downgrade", { planId }),
  upgrade: (planId) => api.post("/api/client-billing/subscription/upgrade", { planId }),
  cancel: () => api.post("/api/client-billing/subscription/cancel"),
};

export const clientPlansApi = {
  list: () => api.get("/api/client-plans"),
  get: (id) => api.get(`/api/client-plans/${id}`),
  create: (body) => api.post("/api/client-plans", body),
  update: (id, body) => api.put(`/api/client-plans/${id}`, body),
  deactivate: (id) => api.post(`/api/client-plans/${id}/deactivate`),
};

// Agency Admin only — connecting/viewing/disconnecting the agency's own
// Razorpay account (Technology Partner OAuth). Never returns a token —
// see agencyRazorpayConnectService.serializeConnection on the backend.
export const agencyRazorpayApi = {
  connect: () => api.get("/api/agency-razorpay/connect"),
  connection: () => api.get("/api/agency-razorpay/connection"),
  disconnect: () => api.delete("/api/agency-razorpay/connection"),
};

// The OLD multi-plan billingApi.plans/subscription/payments/subscribe/
// changePlan client functions (Step 9 subscriptionModel-backed) were
// removed here — zero frontend surfaces called them any more after
// agency-billing.js was migrated to the functions below. Their backend
// routes/controller/service are deliberately left in place (still used by
// any tenant still on that old flow — see billingService.js's own
// comment) even though no frontend wrapper remains to call them.
export const billingApi = {
  // New business model — single-plan self-service Agency subscription
  // (agency_subscription_plan/agency_subscriptions). getAgencyPlan is the
  // PUBLIC price preview (no auth) shown on the signup page and re-used
  // here for the pre-subscribe preview; the other three are the signed-in
  // Agency Admin's own subscription.
  getAgencyPlan: () => api.get("/api/billing/agency-plan"),
  getAgencySubscription: () => api.get("/api/billing/agency-subscription"),
  initiateAgencySubscription: () => api.post("/api/billing/agency-subscription"),
  cancelAgencySubscription: () => api.post("/api/billing/agency-subscription/cancel"),
};

export const superAdminApi = {
  overview: () => api.get("/api/super-admin/overview"),
  listTenants: () => api.get("/api/super-admin/tenants"),
  getTenant: (id) => api.get(`/api/super-admin/tenants/${id}`),
  // Manual escape hatch, separate from self-service Agency signup
  // (POST /api/auth/signup — see auth-signup.js): lets a Super Admin
  // create an agency directly and separately invite its first Agency
  // Admin, e.g. for support/onboarding cases that don't go through
  // self-service signup.
  createAgency: (name) => api.post("/api/super-admin/tenants", { name }),
  inviteAgencyAdmin: (id, body) => api.post(`/api/super-admin/tenants/${id}/invite-admin`, body),
  updateStatus: (id, status) => api.patch(`/api/super-admin/tenants/${id}/status`, { status }),
  // The OLD Step 9 local-plan-catalog and any-tenant-subscription-override
  // client functions (listPlans/createPlan/updatePlan/setPlanActive/
  // getTenantSubscription/changeTenantPlan/suspendTenantSubscription/
  // resumeTenantSubscription/cancelTenantSubscription) were removed here —
  // zero frontend surfaces called them any more after super-admin-plans.js
  // and super-admin-tenant.js were migrated to the new-model functions
  // below. Their backend routes/controller/service are deliberately left
  // in place (still used by any tenant still on that old flow).
  // New business model: the ONE Agency plan Super Admin prices.
  getAgencyPlan: () => api.get("/api/super-admin/agency-plan"),
  upsertAgencyPlan: (body) => api.put("/api/super-admin/agency-plan", body),
  // Read-only view of one Agency's real current subscription (new model) —
  // reuses billingService.getAgencySubscriptionForTenant, the same
  // function the Agency Admin's own billing route calls, just exposed
  // here for any tenant id instead of only the caller's own.
  getTenantAgencySubscription: (id) => api.get(`/api/super-admin/tenants/${id}/agency-subscription`),
};
