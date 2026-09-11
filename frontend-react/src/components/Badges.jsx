// Small presentational badge components — ported from the old frontend's
// components/ui.js (accountStatusBadge/duplicateBadge/followUpStatusBadge/
// licenseStatusBadge/statusPillHtml), now real JSX instead of HTML strings.

export function AccountStatusBadge({ status }) {
  const map = {
    active: { cls: "badge-success", label: "Active" },
    invited: { cls: "badge-warning", label: "Invited" },
    deactivated: { cls: "badge-neutral", label: "Deactivated" },
    suspended: { cls: "badge-danger", label: "Suspended" },
    pending_payment: { cls: "badge-warning", label: "Pending payment" },
    canceled: { cls: "badge-neutral", label: "Canceled" },
    inactive: { cls: "badge-neutral", label: "Inactive" },
  };
  const m = map[status] || { cls: "badge-neutral", label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

export function DuplicateBadge({ isDuplicate }) {
  if (!isDuplicate) return null;
  return <span className="badge badge-warning">Duplicate</span>;
}

export function FollowUpStatusBadge({ status, isOverdue }) {
  if (status === "pending" && isOverdue) return <span className="badge badge-danger">Overdue</span>;
  const cls = { pending: "badge-warning", completed: "badge-success", cancelled: "badge-neutral" }[status] || "badge-neutral";
  const label = { pending: "Pending", completed: "Completed", cancelled: "Cancelled" }[status] || status;
  return <span className={`badge ${cls}`}>{label}</span>;
}

const LICENSE_STATUS_BADGE = { ACTIVE: "badge-success", EXPIRING_SOON: "badge-warning", EXPIRED: "badge-danger", PENDING: "badge-neutral" };
const LICENSE_STATUS_LABEL = { ACTIVE: "Active", EXPIRING_SOON: "Expiring Soon", EXPIRED: "Expired", PENDING: "Pending" };
export function LicenseStatusBadge({ status }) {
  return <span className={`badge ${LICENSE_STATUS_BADGE[status] || "badge-neutral"}`}>{LICENSE_STATUS_LABEL[status] || status}</span>;
}

export function StatusPill({ name, color, isFinal }) {
  if (!name) return <span className="text-tertiary">— none —</span>;
  return (
    <span className="status-pill">
      <span className="dot" style={{ background: color || "#9aa1b3" }} />
      {name}
      {isFinal ? " (final)" : ""}
    </span>
  );
}

export function Avatar({ name, size = "" }) {
  const initials = name
    ? ((name.trim().split(/\s+/)[0]?.[0] || "") + (name.trim().split(/\s+/).length > 1 ? name.trim().split(/\s+/).pop()[0] : "")).toUpperCase()
    : "?";
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}
