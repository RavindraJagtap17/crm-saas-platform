/**
 * Centralized fetch layer — ported 1:1 from the old frontend's
 * api/client.js. Every API call in the app goes through here; nothing
 * calls fetch() directly from a page/component. Same behavior preserved
 * exactly: attaches the access token, one automatic refresh-and-retry on a
 * 401, normalized errors, blob downloads, and multipart uploads.
 */
import { getAccessToken, setAccessToken, clearAccessToken } from "../auth/tokenStore";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let refreshInFlight = null;

async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE_URL}/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        setAccessToken(data.accessToken);
        return data.accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request(method, path, { body, retry = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    const newToken = await refreshAccessToken();
    if (newToken) return request(method, path, { body, retry: false });
    clearAccessToken();
    throw new ApiError("Your session has expired. Please sign in again.", 401, "SESSION_EXPIRED");
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
  }
  return data;
}

// File-download variant — used by CSV export. request() above always
// JSON.parses the body, which would silently discard a CSV response; this
// reads the response as a Blob instead, sharing the same auth/refresh/
// error-normalization behavior.
async function download(method, path, { body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const doFetch = (authHeaders) =>
    fetch(`${API_BASE_URL}${path}`, { method, headers: authHeaders, credentials: "include", body: body !== undefined ? JSON.stringify(body) : undefined });

  let res = await doFetch(headers);

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      clearAccessToken();
      throw new ApiError("Your session has expired. Please sign in again.", 401, "SESSION_EXPIRED");
    }
    res = await doFetch({ ...headers, Authorization: `Bearer ${newToken}` });
  }

  if (!res.ok) {
    let data = null;
    try {
      data = JSON.parse(await res.text());
    } catch {
      // not a JSON error body — fall through with the generic message below
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob, filename: match ? match[1] : "download" };
}

// Multipart file upload — used only by Lead CSV Import's preview step.
// Deliberately does NOT set Content-Type itself: the browser must set it
// (including the multipart boundary) when the body is a FormData.
async function upload(path, file, fieldName = "file") {
  const form = new FormData();
  form.append(fieldName, file);

  const doFetch = (authHeaders) => fetch(`${API_BASE_URL}${path}`, { method: "POST", headers: authHeaders, credentials: "include", body: form });

  const token = getAccessToken();
  let res = await doFetch(token ? { Authorization: `Bearer ${token}` } : {});

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      clearAccessToken();
      throw new ApiError("Your session has expired. Please sign in again.", 401, "SESSION_EXPIRED");
    }
    res = await doFetch({ Authorization: `Bearer ${newToken}` });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, { body }),
  patch: (path, body) => request("PATCH", path, { body }),
  put: (path, body) => request("PUT", path, { body }),
  delete: (path) => request("DELETE", path),
  download: (path, body) => download(body !== undefined ? "POST" : "GET", path, { body }),
  upload: (path, file, fieldName) => upload(path, file, fieldName),
};

export { refreshAccessToken };
