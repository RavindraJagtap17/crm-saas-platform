import { api } from "./client.js";
import { qs } from "../components/ui.js";

export const authApi = {
  google: (idToken) => api.post("/api/auth/google", { idToken }),
  signup: (idToken, agencyName) => api.post("/api/auth/signup", { idToken, agencyName }),
  me: () => api.get("/api/auth/me"),
};

export const tenantApi = {
  get: () => api.get("/api/tenant"),
  update: (body) => api.patch("/api/tenant", body),
};

export const usersApi = {
  list: () => api.get("/api/users"),
  invite: (body) => api.post("/api/users/invite", body),
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

export const customFieldsApi = {
  list: () => api.get("/api/custom-fields"),
  create: (body) => api.post("/api/custom-fields", body),
  update: (id, body) => api.patch(`/api/custom-fields/${id}`, body),
};

export const dashboardApi = {
  summary: () => api.get("/api/dashboard/summary"),
};

export const webFormsApi = {
  list: () => api.get("/api/web-forms"),
  create: (body) => api.post("/api/web-forms", body),
  update: (id, body) => api.patch(`/api/web-forms/${id}`, body),
};

export const superAdminApi = {
  overview: () => api.get("/api/super-admin/overview"),
  listTenants: () => api.get("/api/super-admin/tenants"),
  getTenant: (id) => api.get(`/api/super-admin/tenants/${id}`),
  updateEmployeeLimit: (id, employeeLimit) => api.patch(`/api/super-admin/tenants/${id}/employee-limit`, { employeeLimit }),
  updateStatus: (id, status) => api.patch(`/api/super-admin/tenants/${id}/status`, { status }),
};
