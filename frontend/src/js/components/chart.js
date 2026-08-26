import { escapeHtml } from "./ui.js";

/**
 * Hand-rolled, dependency-free charts — "a lightweight charting solution
 * only if necessary" (§E). No charting library is pulled in; these are a
 * few lines of CSS/SVG each.
 */

// Horizontal bar list — used for source breakdown.
export function barListHtml(items, { labelKey, valueKey, colorVar = "--brand-500" } = {}) {
  const max = Math.max(1, ...items.map((i) => i[valueKey]));
  const total = items.reduce((sum, i) => sum + i[valueKey], 0) || 1;
  return `
    <div class="flex-col gap-3">
      ${items
        .map((item) => {
          const value = item[valueKey];
          const pct = Math.round((value / total) * 100);
          const widthPct = Math.round((value / max) * 100);
          return `
          <div>
            <div class="flex justify-between text-sm mb-2">
              <span class="font-semibold">${escapeHtml(item[labelKey])}</span>
              <span class="text-secondary num">${value} <span class="text-tertiary">(${pct}%)</span></span>
            </div>
            <div style="height:8px;background:var(--bg-surface-2);border-radius:var(--radius-full);overflow:hidden">
              <div style="height:100%;width:${widthPct}%;background:var(${colorVar});border-radius:var(--radius-full);transition:width 480ms var(--ease-out)"></div>
            </div>
          </div>`;
        })
        .join("")}
    </div>`;
}

// Simple SVG column chart — used for monthly lead volume.
export function columnChartSvg(points, { labelKey, valueKey, height = 160 } = {}) {
  const width = Math.max(320, points.length * 64);
  const max = Math.max(1, ...points.map((p) => p[valueKey]));
  const barWidth = (width / points.length) * 0.5;
  const gap = (width / points.length) * 0.5;

  const bars = points
    .map((p, i) => {
      const barHeight = Math.max(2, (p[valueKey] / max) * (height - 32));
      const x = i * (barWidth + gap) + gap / 2;
      const y = height - 24 - barHeight;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="var(--brand-500)" opacity="0.9">
            <title>${escapeHtml(p[labelKey])}: ${p[valueKey]}</title>
          </rect>
          <text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="var(--text-secondary)" font-family="var(--font-mono)">${p[valueKey]}</text>
          <text x="${x + barWidth / 2}" y="${height - 6}" text-anchor="middle" font-size="10" fill="var(--text-tertiary)">${escapeHtml(p[labelKey])}</text>
        </g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Monthly lead volume chart">${bars}</svg>`;
}
