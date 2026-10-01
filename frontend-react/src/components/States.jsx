// EmptyState / ErrorState / Skeleton — ported from the old frontend's
// components/ui.js as real components instead of HTML-string builders.

export function EmptyState({ icon = "◇", title, desc, action }) {
  return (
    <div className="state-block">
      <div className="state-icon" aria-hidden="true">{icon}</div>
      <div className="state-title">{title}</div>
      {desc ? <div className="state-desc">{desc}</div> : null}
      {action ? <div className="state-actions">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", desc, onRetry, retryLabel = "Try again" }) {
  return (
    <div className="state-block">
      <div className="state-icon" aria-hidden="true">⚠</div>
      <div className="state-title">{title}</div>
      {desc ? <div className="state-desc">{desc}</div> : null}
      {onRetry ? (
        <div className="state-actions">
          <button className="btn btn-secondary" onClick={onRetry}>
            {retryLabel}
          </button>
        </div>
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
