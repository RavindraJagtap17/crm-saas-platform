// Ported 1:1 from the old frontend's api/resources.js — same endpoints,
// same request shapes, same response handling. Every API contract this
// app depends on lives here, in one place.
import { api } from "./client";
import { qs } from "../utils/qs";

export const authApi = {
  google: (idToken) => api.post("/api/auth/google", { idToken }),
  signup: (idToken, fields) => api.post("/api/auth/signup", { idToken, ...fields }),
  me: () => api.get("/api/auth/me"),
  devLogin: (role) => api.post("/api/auth/dev-login", { role }),
  logout: () => api.post("/api/auth/logout"),
};

export const tenantApi = {
  get: () => api.get("/api/tenant"),
  update: (body) => api.patch("/api/tenant", body),
};

export const clientsApi = {
  list: () => api.get("/api/clients"),
  get: (id) => api.get(`/api/clients/${id}`),
  create: (body) => api.post("/api/clients", body),
  setStatus: (id, status) => api.patch(`/api/clients/${id}/status`, { status }),
  inviteAdmin: (id, body) => api.post(`/api/clients/${id}/invite-admin`, body),
  limit: () => api.get("/api/clients/limit"),
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
  bulkAssign: (leadIds, assignedTo) => api.post("/api/leads/bulk/assign", { leadIds, assignedTo }),
  bulkChangeStatus: (leadIds, statusId) => api.post("/api/leads/bulk/status", { leadIds, statusId }),
  exportFiltered: (query) => api.download(`/api/leads/export${qs(query)}`),
  exportSelected: (leadIds) => api.download("/api/leads/export-selected", { leadIds }),
  previewImport: (file) => api.upload("/api/leads/import/preview", file),
  confirmImport: (token) => api.post("/api/leads/import", { token }),
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

export const customFieldsApi = {
  list: () => api.get("/api/custom-fields"),
};

export const dashboardApi = {
  summary: () => api.get("/api/dashboard/summary"),
  followUpCounts: () => api.get("/api/dashboard/follow-up-counts"),
};

export const webFormsApi = {
  list: () => api.get("/api/web-forms"),
  create: (body) => api.post("/api/web-forms", body),
  update: (id, body) => api.patch(`/api/web-forms/${id}`, body),
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

export const linkedinApi = {
  connect: (ownerType, ownerId) => api.get(`/api/integrations/linkedin/connect${qs({ ownerType, ownerId })}`),
  connection: () => api.get("/api/integrations/linkedin/connection"),
  disconnect: () => api.delete("/api/integrations/linkedin/connection"),
  forms: () => api.get("/api/integrations/linkedin/forms"),
  mappings: (externalFormId) => api.get(`/api/integrations/linkedin/mappings${qs({ externalFormId })}`),
  createMapping: (body) => api.post("/api/integrations/linkedin/mappings", body),
  updateMapping: (id, body) => api.patch(`/api/integrations/linkedin/mappings/${id}`, body),
  removeMapping: (id) => api.delete(`/api/integrations/linkedin/mappings/${id}`),
  events: (limit) => api.get(`/api/integrations/linkedin/events${qs({ limit })}`),
};

export const googleAdsApi = {
  connect: () => api.post("/api/integrations/google/connect"),
  connection: () => api.get("/api/integrations/google/connection"),
  disconnect: () => api.delete("/api/integrations/google/connection"),
  mappings: (externalFormId) => api.get(`/api/integrations/google/mappings${qs({ externalFormId })}`),
  createMapping: (body) => api.post("/api/integrations/google/mappings", body),
  updateMapping: (id, body) => api.patch(`/api/integrations/google/mappings/${id}`, body),
  removeMapping: (id) => api.delete(`/api/integrations/google/mappings/${id}`),
  events: (limit) => api.get(`/api/integrations/google/events${qs({ limit })}`),
};

export const indiamartApi = {
  connect: () => api.post("/api/integrations/indiamart/connect"),
  connection: () => api.get("/api/integrations/indiamart/connection"),
  disconnect: () => api.delete("/api/integrations/indiamart/connection"),
  mappings: () => api.get("/api/integrations/indiamart/mappings"),
  createMapping: (body) => api.post("/api/integrations/indiamart/mappings", body),
  updateMapping: (id, body) => api.patch(`/api/integrations/indiamart/mappings/${id}`, body),
  removeMapping: (id) => api.delete(`/api/integrations/indiamart/mappings/${id}`),
  events: (limit) => api.get(`/api/integrations/indiamart/events${qs({ limit })}`),
};

export const superAdminApi = {
  overview: () => api.get("/api/super-admin/overview"),
  listTenants: (query) => api.get(`/api/super-admin/tenants${qs(query)}`),
  getTenant: (id) => api.get(`/api/super-admin/tenants/${id}`),
  getClient: (tenantId, clientId) => api.get(`/api/super-admin/tenants/${tenantId}/clients/${clientId}`),
  createAgency: (name) => api.post("/api/super-admin/tenants", { name }),
  inviteAgencyAdmin: (id, body) => api.post(`/api/super-admin/tenants/${id}/invite-admin`, body),
  updateStatus: (id, status) => api.patch(`/api/super-admin/tenants/${id}/status`, { status }),
  getClientLicensePrice: () => api.get("/api/super-admin/client-license-price"),
  upsertClientLicensePrice: (body) => api.put("/api/super-admin/client-license-price", body),
  listIntegrationEvents: (query) => api.get(`/api/super-admin/integration-events${qs(query)}`),
  getIntegrationEvent: (id) => api.get(`/api/super-admin/integration-events/${id}`),
  retryIntegrationEvent: (id) => api.post(`/api/super-admin/integration-events/${id}/retry`),
  getRetryHistory: (id) => api.get(`/api/super-admin/integration-events/${id}/retry-history?pageSize=50`),
};
