import { emptyState, skeletonRows } from "./ui.js";

/**
 * Generic table renderer shared by every list page (leads, users,
 * tenants, …). `columns` is [{ key, label, render(row) }]; `onRowClick`
 * is optional. Handles its own responsive card-row fallback via CSS
 * (see components.css) using each cell's data-label attribute.
 */
export function renderTable(container, { columns, rows, onRowClick, rowKey = "id", empty }) {
  if (!rows) {
    container.innerHTML = `<div class="table-wrap"><div style="padding:var(--space-4)">${skeletonRows(6)}</div></div>`;
    return;
  }
  if (rows.length === 0) {
    container.innerHTML = `<div class="table-wrap">${emptyState(empty || { title: "Nothing here yet" })}</div>`;
    return;
  }

  const theadHtml = `<tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;
  const tbodyHtml = rows
    .map((row) => {
      const cells = columns
        .map((c) => `<td data-label="${c.label}">${c.render(row)}</td>`)
        .join("");
      return `<tr data-row-id="${row[rowKey]}" class="${onRowClick ? "is-clickable" : ""}" ${
        onRowClick ? 'tabindex="0" role="button"' : ""
      }>${cells}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>${theadHtml}</thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;

  if (onRowClick) {
    container.querySelectorAll("tbody tr").forEach((tr) => {
      const row = rows.find((r) => String(r[rowKey]) === tr.dataset.rowId);
      const activate = () => onRowClick(row);
      tr.addEventListener("click", activate);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    });
  }
}
