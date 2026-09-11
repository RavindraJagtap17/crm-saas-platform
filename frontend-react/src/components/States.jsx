// EmptyState / ErrorState / Skeleton — ported from the old frontend's
// components/ui.js as real components instead of HTML-string builders.

export function EmptyState({ icon = "◇", title, desc, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", desc, onRetry, retryLabel = "Try again" }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">⚠</div>
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {onRetry ? (
        <button className="btn btn-secondary mt-3" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonRows({ count = 5 }) {
  return (
    <div className="flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}

export function SkeletonStatCards({ count = 4 }) {
  return (
    <div className="grid-stats mb-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card stat-card">
          <div className="skeleton skeleton-text" style={{ width: "60%" }} />
          <div className="skeleton skeleton-row" style={{ width: "40%", height: 28 }} />
        </div>
      ))}
    </div>
  );
}
