import { SkeletonRows } from "./States";
import { EmptyState } from "./States";

/**
 * Generic table renderer — ported from the old frontend's
 * components/dataTable.js. `columns` is [{ key, label, render(row) }]
 * where render() now returns JSX instead of an HTML string. `rows === null`
 * means "loading" (shows skeleton, same as the old renderTable's contract).
 */
export default function DataTable({ columns, rows, onRowClick, rowKey = "id", empty }) {
  if (rows === null) {
    return (
      <div className="table-wrap">
        <div style={{ padding: "var(--space-4)" }}>
          <SkeletonRows count={6} />
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <EmptyState {...(empty || { title: "Nothing here yet" })} />
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              className={onRowClick ? "is-clickable" : ""}
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? "button" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td key={c.key} data-label={c.label}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
