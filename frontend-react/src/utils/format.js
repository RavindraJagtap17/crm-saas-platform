// Pure formatting helpers — ported directly from the old frontend's
// components/ui.js. escapeHtml/qs are dropped here: React escapes text
// content automatically, and qs() lives in utils/qs.js (used by the API
// layer, not the UI layer).

export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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

export function formatMoney(smallestUnitAmount, currency = "INR") {
  if (smallestUnitAmount === null || smallestUnitAmount === undefined) return "—";
  const amount = smallestUnitAmount / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatMonthLabel(yyyyMm) {
  const [y, m] = String(yyyyMm).split("-").map(Number);
  if (!y || !m) return yyyyMm;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export function relativeTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return `${diffDay}d ago`;
  return formatDate(value);
}

export function roleLabel(role) {
  return { super_admin: "Super Admin", agency_admin: "Agency Admin", client_admin: "Client Admin", client_employee: "Client Employee" }[role] || role;
}

export function formatDaysRemaining(days) {
  if (days === null || days === undefined) return "—";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  return `${days} day${days === 1 ? "" : "s"}`;
}
