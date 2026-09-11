// Ported from the old frontend's paginationHtml() (components/ui.js).
export default function Pagination({ page, pageSize, total, totalPages, onPrev, onNext }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="pagination">
      <span className="text-sm text-secondary">
        Showing {from}–{to} of {total}
      </span>
      <div className="flex gap-2 items-center">
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={onPrev}>
          ← Prev
        </button>
        <span className="text-sm text-secondary">
          Page {page} of {totalPages}
        </span>
        <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={onNext}>
          Next →
        </button>
      </div>
    </div>
  );
}
