export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase();
}

export function avatarHtml(name, size = "") {
  return `<span class="avatar ${size}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatMonthLabel(yyyyMm) {
  const [y, m] = yyyyMm.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export function relativeTime(value) {
  if (!value) return "—";
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

const ROLE_LABELS = { super_admin: "Super Admin", tenant_admin: "Admin", tenant_employee: "Employee" };
export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

const STATUS_BADGE = {
  active: "badge-success",
  invited: "badge-warning",
  deactivated: "badge-neutral",
  pending_payment: "badge-warning",
  suspended: "badge-danger",
  canceled: "badge-neutral",
};
export function accountStatusBadge(status) {
  const cls = STATUS_BADGE[status] || "badge-neutral";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

export function duplicateBadge(isDuplicate) {
  if (!isDuplicate) return "";
  return `<span class="badge badge-warning" title="Another lead shares this phone number">⧉ Duplicate</span>`;
}

export function statusPillHtml(name, color, isFinal) {
  const dotColor = color || "#9aa1b3";
  return `<span class="status-pill"><span class="dot" style="background:${escapeHtml(dotColor)}"></span>${escapeHtml(name)}${
    isFinal ? ' <span class="text-tertiary">· final</span>' : ""
  }</span>`;
}

export function emptyState({ icon = "◇", title, desc, actionHtml = "" }) {
  return `
    <div class="state-block">
      <div class="state-icon" aria-hidden="true">${icon}</div>
      <div class="state-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="state-desc">${escapeHtml(desc)}</div>` : ""}
      ${actionHtml ? `<div class="state-actions">${actionHtml}</div>` : ""}
    </div>`;
}

export function errorState({ title = "Something went wrong", desc, retryLabel = "Try again" } = {}) {
  return `
    <div class="state-block">
      <div class="state-icon" aria-hidden="true">⚠</div>
      <div class="state-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="state-desc">${escapeHtml(desc)}</div>` : ""}
      <div class="state-actions"><button class="btn btn-secondary" data-retry>${retryLabel}</button></div>
    </div>`;
}

export function skeletonRows(count = 5) {
  return Array.from({ length: count })
    .map(() => `<div class="skeleton skeleton-row" style="width:${60 + Math.random() * 30}%"></div>`)
    .join("");
}

export function paginationHtml({ page, pageSize, total, totalPages }) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return `
    <div class="pagination">
      <div class="pagination-info">${total === 0 ? "No results" : `Showing ${start}–${end} of ${total}`}</div>
      <div class="pagination-controls">
        <button class="btn btn-secondary btn-sm" data-page="prev" ${page <= 1 ? "disabled" : ""}>← Prev</button>
        <button class="btn btn-secondary btn-sm" data-page-label disabled>Page ${page} of ${totalPages}</button>
        <button class="btn btn-secondary btn-sm" data-page="next" ${page >= totalPages ? "disabled" : ""}>Next →</button>
      </div>
    </div>`;
}

export function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.classList.toggle("is-loading", loading);
  btn.disabled = loading;
  if (loading && !btn.querySelector(".spinner")) {
    btn.insertAdjacentHTML("beforeend", '<span class="spinner" aria-hidden="true"></span>');
  }
}

export function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : "";
}
