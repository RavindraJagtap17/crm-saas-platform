import { useState } from "react";
import Modal from "./Modal";
import LoadingButton from "./LoadingButton";

// Splits a stored ISO instant back into <input type="date">/<input
// type="time"> values in the VIEWER's own local timezone — ported from
// the old frontend's followUpPanel.js toDateTimeInputs/combineDateTimeToIso.
function toDateTimeInputs(isoValue) {
  const d = new Date(isoValue);
  const pad = (n) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function combineDateTimeToIso(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [y, mo, da] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const d = new Date(y, mo - 1, da, h, mi, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Reusable schedule/reschedule modal — ported from the old frontend's
 * components/followUpPanel.js openScheduleModal(). Used by both the lead
 * detail page's Follow-ups panel AND the standalone Follow-ups list pages.
 */
export default function ScheduleFollowUpModal({ open, title, currentUser, assignableUsers, defaults, onClose, onSubmit }) {
  const initial = defaults?.scheduledAt ? toDateTimeInputs(defaults.scheduledAt) : { date: "", time: "" };
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [assignedTo, setAssignedTo] = useState(defaults?.assignedTo ?? currentUser.id);
  const [notes, setNotes] = useState(defaults?.notes || "");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleSave = async () => {
    setError(null);
    const scheduledAt = combineDateTimeToIso(date, time);
    if (!scheduledAt) {
      setError("Date and time are both required.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ scheduledAt, assignedTo: Number(assignedTo), notes: notes.trim() || undefined });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={handleSave}>Save</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="fu-date">Date</label>
            <input className="input" type="date" id="fu-date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="fu-time">Time</label>
            <input className="input" type="time" id="fu-time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        {!assignableUsers ? (
          <div className="field">
            <label className="label">Assigned To</label>
            <input className="input" value={`${currentUser.name} (you)`} disabled />
          </div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="fu-assigned">Assigned To</label>
            <select className="select" id="fu-assigned" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role.replace("client_", "")})</option>
              ))}
            </select>
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label" htmlFor="fu-notes">
            Notes <span className="optional">(optional)</span>
          </label>
          <textarea className="textarea" id="fu-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}
