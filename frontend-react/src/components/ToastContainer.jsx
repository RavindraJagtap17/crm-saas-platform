import { useEffect, useState } from "react";
import { subscribeToasts } from "./toast";

const ICONS = { success: "✓", error: "✕", info: "ℹ" };

export default function ToastContainer() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    return subscribeToasts((event) => {
      if (event.type === "add") {
        setItems((prev) => [...prev, event.entry]);
      } else if (event.type === "remove") {
        setItems((prev) => prev.filter((i) => i.id !== event.id));
      }
    });
  }, []);

  const dismiss = (id) => setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast toast-${item.type}`}>
          <span className="toast-icon" aria-hidden="true">{ICONS[item.type] || ICONS.info}</span>
          <span>{item.message}</span>
          <button className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
