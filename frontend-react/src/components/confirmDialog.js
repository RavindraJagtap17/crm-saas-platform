// Ported from the old frontend's components/modal.js (confirmDialog) —
// same call shape (`const ok = await confirmDialog({...})`), implemented
// as a pub/sub singleton so any page/handler can call it as a plain
// function, exactly like the old app did. <ConfirmDialogHost/> (mounted
// once in App.jsx) renders the current pending request via <Modal/>.

let listener = null;

export function subscribeConfirmDialog(fn) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener({ title, message, confirmLabel, danger, resolve });
  });
}
