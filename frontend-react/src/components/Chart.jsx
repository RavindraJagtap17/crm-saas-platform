// Hand-rolled, dependency-free charts — ported from the old frontend's
// components/chart.js. No charting library introduced.

export function BarList({ items, labelKey, valueKey, colorVar = "--brand-500" }) {
  const max = Math.max(1, ...items.map((i) => i[valueKey]));
  const total = items.reduce((sum, i) => sum + i[valueKey], 0) || 1;
  return (
    <div className="flex-col gap-3">
      {items.map((item, i) => {
        const value = item[valueKey];
        const pct = Math.round((value / total) * 100);
        const widthPct = Math.round((value / max) * 100);
        return (
          <div key={i}>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-semibold">{item[labelKey]}</span>
              <span className="text-secondary num">
                {value} <span className="text-tertiary">({pct}%)</span>
              </span>
            </div>
            <div style={{ height: 8, background: "var(--bg-surface-2)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${widthPct}%`,
                  background: `var(${colorVar})`,
                  borderRadius: "var(--radius-full)",
                  transition: "width 480ms var(--ease-out)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ColumnChart({ points, labelKey, valueKey, height = 160 }) {
  const width = Math.max(320, points.length * 64);
  const max = Math.max(1, ...points.map((p) => p[valueKey]));
  const barWidth = (width / points.length) * 0.5;
  const gap = (width / points.length) * 0.5;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Monthly lead volume chart">
      {points.map((p, i) => {
        const barHeight = Math.max(2, (p[valueKey] / max) * (height - 32));
        const x = i * (barWidth + gap) + gap / 2;
        const y = height - 24 - barHeight;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={4} fill="var(--brand-500)" opacity={0.9}>
              <title>
                {p[labelKey]}: {p[valueKey]}
              </title>
            </rect>
            <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="var(--text-secondary)" fontFamily="var(--font-mono)">
              {p[valueKey]}
            </text>
            <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--text-tertiary)">
              {p[labelKey]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
