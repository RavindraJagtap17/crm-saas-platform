import { useEffect, useState } from "react";
import Modal from "./Modal";
import { subscribeConfirmDialog } from "./confirmDialog";

export default function ConfirmDialogHost() {
  const [request, setRequest] = useState(null);

  useEffect(() => subscribeConfirmDialog(setRequest), []);

  if (!request) return null;

  const settle = (result) => {
    request.resolve(result);
    setRequest(null);
  };

  return (
    <Modal
      open
      title={request.title}
      onClose={() => settle(false)}
      footer={
        <>
          <button className="btn btn-secondary" onClick={() => settle(false)}>Cancel</button>
          <button className={`btn ${request.danger ? "btn-danger" : "btn-primary"}`} onClick={() => settle(true)}>
            {request.confirmLabel}
          </button>
        </>
      }
    >
      <p>{request.message}</p>
    </Modal>
  );
}
