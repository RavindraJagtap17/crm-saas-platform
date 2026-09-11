// Ported from the old frontend's components/toast.js. A simple pub/sub so
// `toast()/toastSuccess()/toastError()` can be called as plain imported
// functions from anywhere (an event handler, a hook, a service) exactly
// like the old app did — without every caller needing useContext/a hook.
// <ToastContainer/> (mounted once in App.jsx) is the sole subscriber that
// actually renders anything.

let listeners = [];
let nextId = 1;

export function subscribeToasts(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function toast(message, { type = "info", duration = 4200 } = {}) {
  const id = nextId++;
  const entry = { id, message, type };
  listeners.forEach((l) => l({ type: "add", entry }));
  if (duration) {
    setTimeout(() => listeners.forEach((l) => l({ type: "remove", id })), duration);
  }
  return () => listeners.forEach((l) => l({ type: "remove", id }));
}

export const toastSuccess = (msg) => toast(msg, { type: "success" });
export const toastError = (msg) => toast(msg, { type: "error", duration: 6000 });
