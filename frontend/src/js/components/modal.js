/**
 * openModal renders arbitrary body HTML in a dialog; confirmDialog is the
 * shared "are you sure?" pattern used before every destructive action
 * (§I: "confirmation states for destructive actions").
 */
export function openModal({ title, bodyHtml, footerHtml, onMount, closeLabel = "Close" }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 class="modal-title" id="modal-title">${title}</h2>
        <button class="modal-close" aria-label="${closeLabel}">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ""}
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  function close() {
    overlay.remove();
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
  }
  function onKeydown(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKeydown);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".modal-close").addEventListener("click", close);

  const modalEl = overlay.querySelector(".modal");
  if (onMount) onMount(modalEl, close);

  const firstField = modalEl.querySelector("input, select, textarea, button:not(.modal-close)");
  if (firstField) firstField.focus();

  return { close, el: modalEl };
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const { close } = openModal({
      title,
      bodyHtml: `<p>${message}</p>`,
      footerHtml: `
        <button class="btn btn-secondary" data-cancel>Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${confirmLabel}</button>
      `,
      onMount: (modalEl, closeFn) => {
        modalEl.querySelector("[data-cancel]").addEventListener("click", () => {
          closeFn();
          resolve(false);
        });
        modalEl.querySelector("[data-confirm]").addEventListener("click", () => {
          closeFn();
          resolve(true);
        });
      },
    });
    void close;
  });
}
