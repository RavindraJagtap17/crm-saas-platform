import { useEffect, useState } from "react";
import { usersApi } from "../../api/resources";
import { usePageTitle } from "../../layouts/PageTitleContext";
import Modal from "../../components/Modal";
import LoadingButton from "../../components/LoadingButton";
import { confirmDialog } from "../../components/confirmDialog";
import { toastSuccess, toastError } from "../../components/toast";
import { AccountStatusBadge, Avatar } from "../../components/Badges";
import { EmptyState, SkeletonRows } from "../../components/States";
import { formatDate, roleLabel } from "../../utils/format";

function InviteModal({ open, onClose, onInvited }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await usersApi.invite({ name: name.trim(), email: email.trim(), role: "client_employee" });
      toastSuccess("Invite created — they can now sign in with Google using that email.");
      onInvited();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Invite an employee"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <LoadingButton className="btn btn-primary" loading={saving} onClick={submit}>Send invite</LoadingButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label className="label" htmlFor="inv-name">Name</label>
          <input className="input" id="inv-name" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="inv-email">Email</label>
          <input className="input" type="email" id="inv-email" placeholder="jane@client-company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="hint">They'll sign in with this exact Google account.</span>
        </div>
        {error ? <div className="field-error">{error}</div> : null}
      </form>
    </Modal>
  );
}

export default function Employees() {
  usePageTitle("Employees");
  const [users, setUsers] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [error, setError] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const refresh = async () => {
    setUsers(null);
    setError(null);
    try {
      const { users: u, invitations: inv } = await usersApi.list();
      setUsers(u);
      setInvitations(inv);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const cancelInvite = async (id) => {
    const ok = await confirmDialog({ title: "Cancel this invitation?", message: "This immediately frees up the seat it was reserving.", confirmLabel: "Cancel invitation", danger: true });
    if (!ok) return;
    setBusyId(id);
    try {
      await usersApi.cancelInvitation(id);
      toastSuccess("Invitation cancelled.");
      await refresh();
    } catch (err) {
      toastError(err.message);
      setBusyId(null);
    }
  };

  const deactivate = async (id) => {
    const ok = await confirmDialog({ title: "Deactivate this account?", message: "They'll no longer be able to sign in. You can reactivate them later.", confirmLabel: "Deactivate", danger: true });
    if (!ok) return;
    try {
      await usersApi.setStatus(id, "deactivated");
      toastSuccess("Account deactivated.");
      await refresh();
    } catch (err) {
      toastError(err.message);
    }
  };

  const reactivate = async (id) => {
    setBusyId(id);
    try {
      await usersApi.setStatus(id, "active");
      toastSuccess("Account reactivated.");
      await refresh();
    } catch (err) {
      toastError(err.message);
      setBusyId(null);
    }
  };

  const roster = users ? users.filter((u) => u.status !== "invited") : [];
  const activeCount = roster.filter((u) => u.status === "active").length;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Employees</h2>
          <p className="page-subtitle">{activeCount} active team member(s)</p>
        </div>
        <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>+ Invite</button>
      </div>

      {invitations.length ? (
        <div className="card mb-4">
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Invited</th><th></th></tr></thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td data-label="Name">{inv.name}</td>
                    <td data-label="Email">{inv.email}</td>
                    <td data-label="Invited">{formatDate(inv.createdAt)}</td>
                    <td data-label=""><button className="btn btn-ghost btn-sm" disabled={busyId === inv.id} onClick={() => cancelInvite(inv.id)}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card">
        {users === null ? (
          <div className="card-body">{error ? <EmptyState icon="⚠" title="Couldn't load your team" desc={error} /> : <SkeletonRows count={1} />}</div>
        ) : !roster.length ? (
          <div className="card-body"><EmptyState title="No team members yet" /></div>
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead>
              <tbody>
                {roster.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Name">
                      <div className="flex items-center gap-2">
                        <Avatar name={u.name} size="avatar-sm" />
                        <div>
                          <div className="table-cell-primary">{u.name}</div>
                          <div className="table-cell-muted text-xs">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Role">{roleLabel(u.role)}</td>
                    <td data-label="Status"><AccountStatusBadge status={u.status} /></td>
                    <td data-label="Joined">{formatDate(u.createdAt)}</td>
                    <td data-label="">
                      {u.status === "deactivated" ? (
                        <button className="btn btn-secondary btn-sm" disabled={busyId === u.id} onClick={() => reactivate(u.id)}>Reactivate</button>
                      ) : u.role === "client_employee" ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => deactivate(u.id)}>Deactivate</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={async () => { setInviteOpen(false); await refresh(); }} />
    </>
  );
}
