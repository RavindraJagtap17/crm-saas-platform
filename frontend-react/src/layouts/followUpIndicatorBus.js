// Tiny pub/sub so any page that mutates a follow-up (schedule/reschedule/
// complete/cancel) can trigger the Shell's topbar indicator to refresh in
// place, exactly like the old frontend's shell.js exported
// refreshFollowUpIndicator() for followUpPanel.js/admin-follow-ups.js to
// call after a mutation.
let listeners = [];

export function subscribeFollowUpIndicator(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function refreshFollowUpIndicator() {
  listeners.forEach((l) => l());
}
