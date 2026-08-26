import { requireRole } from "../session.js";
import { mountShell } from "../components/shell.js";
import { applyTenantBranding } from "../branding.js";
import { productsApi } from "../api/resources.js";
import { openModal } from "../components/modal.js";
import { toastSuccess } from "../components/toast.js";
import { escapeHtml, emptyState, setButtonLoading } from "../components/ui.js";

async function refresh(listEl) {
  listEl.innerHTML = `<div class="card-body"><div class="skeleton skeleton-row"></div></div>`;
  try {
    const { products } = await productsApi.list(true);
    if (!products.length) {
      listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "▣", title: "No products yet", desc: "Add the services or products leads can be tagged against." })}</div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="table-wrap" style="border:none;border-radius:0">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Description</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${products
              .map(
                (p) => `
              <tr>
                <td data-label="Name" class="table-cell-primary">${escapeHtml(p.name)}</td>
                <td data-label="Description" class="table-cell-muted">${escapeHtml(p.description || "—")}</td>
                <td data-label="Status">${p.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Disabled</span>'}</td>
                <td data-label=""><button class="btn btn-secondary btn-sm" data-edit="${p.id}">Edit</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
    listEl.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openForm(listEl, products.find((p) => String(p.id) === btn.dataset.edit)))
    );
  } catch (err) {
    listEl.innerHTML = `<div class="card-body">${emptyState({ icon: "⚠", title: "Couldn't load products", desc: err.message })}</div>`;
  }
}

function openForm(listEl, product) {
  const isEdit = !!product;
  openModal({
    title: isEdit ? "Edit product" : "New product",
    bodyHtml: `
      <form id="p-form" novalidate>
        <div class="field">
          <label class="label" for="p-name">Name</label>
          <input class="input" id="p-name" value="${escapeHtml(product?.name || "")}" placeholder="e.g. Consulting" />
        </div>
        <div class="field">
          <label class="label" for="p-desc">Description <span class="optional">(optional)</span></label>
          <textarea class="textarea" id="p-desc">${escapeHtml(product?.description || "")}</textarea>
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="p-active" ${product ? (product.is_active ? "checked" : "") : "checked"} />
          <label for="p-active" class="text-sm">Active (selectable on new leads)</label>
        </div>
        <div class="field-error" id="p-error" hidden></div>
      </form>`,
    footerHtml: `<button class="btn btn-secondary" data-cancel>Cancel</button><button class="btn btn-primary" id="p-submit">${isEdit ? "Save changes" : "Create product"}</button>`,
    onMount: (modalEl, closeFn) => {
      modalEl.querySelector("[data-cancel]").addEventListener("click", closeFn);
      modalEl.querySelector("#p-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const errEl = modalEl.querySelector("#p-error");
        errEl.hidden = true;
        setButtonLoading(btn, true);
        const body = {
          name: modalEl.querySelector("#p-name").value.trim(),
          description: modalEl.querySelector("#p-desc").value.trim() || undefined,
          isActive: modalEl.querySelector("#p-active").checked,
        };
        try {
          if (isEdit) await productsApi.update(product.id, body);
          else await productsApi.create(body);
          closeFn();
          toastSuccess(isEdit ? "Product updated." : "Product created.");
          refresh(listEl);
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = err.message;
        } finally {
          setButtonLoading(btn, false);
        }
      });
    },
  });
}

async function main() {
  const user = await requireRole("tenant_admin");
  if (!user) return;
  await applyTenantBranding();
  const content = mountShell({ activeKey: "products", title: "Products" });
  content.innerHTML = `
    <div class="page-header">
      <div><h2 class="page-title">Products</h2><p class="page-subtitle">Services leads can be tagged against.</p></div>
      <button class="btn btn-primary" id="new-btn">+ New Product</button>
    </div>
    <div class="card" id="list"></div>
  `;
  document.getElementById("new-btn").addEventListener("click", () => openForm(document.getElementById("list")));
  await refresh(document.getElementById("list"));
}

main();
