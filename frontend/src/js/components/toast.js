let region = null;
function ensureRegion() {
  if (region) return region;
  region = document.createElement("div");
  region.className = "toast-region";
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  document.body.appendChild(region);
  return region;
}

const ICONS = { success: "✓", error: "✕", info: "ℹ" };

export function toast(message, { type = "info", duration = 4200 } = {}) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${ICONS[type] || ICONS.info}</span>
    <span>${message}</span>
    <button class="toast-close" aria-label="Dismiss notification">✕</button>
  `;
  ensureRegion().appendChild(el);

  const remove = () => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 160);
  };
  el.querySelector(".toast-close").addEventListener("click", remove);
  if (duration) setTimeout(remove, duration);
  return remove;
}

export const toastSuccess = (msg) => toast(msg, { type: "success" });
export const toastError = (msg) => toast(msg, { type: "error", duration: 6000 });
