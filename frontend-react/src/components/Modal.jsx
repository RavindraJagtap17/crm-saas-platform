import { useEffect } from "react";

/**
 * Reusable modal shell — ported from the old frontend's components/modal.js
 * (openModal), now a controlled React component taking JSX children
 * instead of an HTML string + onMount wiring. Same visual behavior: overlay
 * click closes, Escape closes, body scroll lock while open.
 */
export default function Modal({ open, title, onClose, footer, children, closeLabel = "Close" }) {
  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = "hidden";
    const onKeydown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 className="modal-title" id="modal-title">{title}</h2>
          <button className="modal-close" aria-label={closeLabel} onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
