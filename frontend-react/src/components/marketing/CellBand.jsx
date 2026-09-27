/**
 * Decorative, cell-grid ambient effect for a dark section (currently used
 * behind CTASection's copy) — adapted from the "animated pixel band"
 * visual idea, built with plain divs + CSS keyframes instead of the
 * TypeScript/Tailwind/canvas original. No per-frame JS: every cell gets a
 * fixed animation-delay via a CSS custom property set once at render, so
 * the wave/glow motion is entirely CSS-driven and pauses for free when the
 * tab is backgrounded. Purely decorative — aria-hidden, pointer-events
 * disabled, and it sits behind the section's real content via z-index.
 */
const COLUMNS = 24;
const ROWS = 5;
const CELLS = Array.from({ length: COLUMNS * ROWS }, (_, i) => i);

export default function CellBand({ variant = "dark" }) {
  return (
    <div className={`mkt-cellband mkt-cellband--${variant}`} aria-hidden="true">
      <div className="mkt-cellband-grid">
        {CELLS.map((i) => {
          const col = i % COLUMNS;
          const row = Math.floor(i / COLUMNS);
          const delay = ((col + row * 3) % 14) * 110;
          return <span key={i} className="mkt-cellband-cell" style={{ "--d": `${delay}ms` }} />;
        })}
      </div>
      <div className="mkt-cellband-sweep" />
    </div>
  );
}
