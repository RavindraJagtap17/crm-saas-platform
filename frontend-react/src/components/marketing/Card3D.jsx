import { useRef } from "react";

const MAX_TILT = 12;

/**
 * Pointer-driven 3D tilt card. The outer element supplies perspective; the
 * inner body rotates from CSS variables set on pointer move, and children
 * marked with data-depth float toward the viewer (see .mkt-3d in
 * marketing.css). The tilt only applies for hover-capable pointers and
 * respects prefers-reduced-motion — both handled in CSS, so touch devices
 * just see a normal card.
 */
export default function Card3D({ as: Tag = "article", className = "", children, ...rest }) {
  const bodyRef = useRef(null);

  const handleMove = (e) => {
    if (e.pointerType === "touch") return;
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--ry", `${(x * MAX_TILT * 2).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-y * MAX_TILT * 2).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${((x + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${((y + 0.5) * 100).toFixed(1)}%`);
  };

  const handleLeave = () => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.removeProperty("--ry");
    el.style.removeProperty("--rx");
    el.style.removeProperty("--mx");
    el.style.removeProperty("--my");
  };

  return (
    <div className="mkt-3d" onPointerMove={handleMove} onPointerLeave={handleLeave}>
      <Tag ref={bodyRef} className={`mkt-3d-body ${className}`.trim()} {...rest}>
        {children}
      </Tag>
    </div>
  );
}
