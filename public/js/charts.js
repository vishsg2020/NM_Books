// Small SVG bar charts. No library and no inline styles (the app's Content-Security-Policy forbids them):
// sizes are SVG attributes and colours come from styles.css.
import { esc } from './core.js';

const short = n => (n >= 1e7 ? (n / 1e7).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' Cr' : n >= 1e5 ? (n / 1e5).toFixed(n >= 1e6 ? 1 : 2).replace(/\.?0+$/, '') + ' L' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)); const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/**
 * Vertical bars: one per row, in the order given. rows: [{ label, value, tip, href }].
 * `money` puts ₹ in front of the axis and bar values.
 */
export function columnChart(rows, { money = true, title = 'Chart' } = {}) {
  if (!rows.length) return '<div class="state">Nothing to show for this period.</div>';
  const W = 920, H = 300, L = 52, R = 8, T = 22, B = 46;
  const max = niceMax(Math.max(...rows.map(r => r.value)));
  const iw = W - L - R, ih = H - T - B, step = iw / rows.length, bw = Math.max(Math.min(step * 0.7, 56), 2);
  const y = v => T + ih - (v / max) * ih; const pre = money ? '₹' : '';
  const every = Math.ceil(rows.length / 16); // thin out the labels when there are many bars
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${pre}${short(max * f)}</text>`).join('');
  const bars = rows.map((r, i) => {
    const x = L + i * step + (step - bw) / 2; const h = Math.max(T + ih - y(r.value), r.value > 0 ? 1 : 0); const cx = x + bw / 2;
    const rect = `<rect class="cbar" x="${x.toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(r.tip || `${r.label}: ${pre}${r.value}`)}</title></rect>`;
    return (r.href ? `<a href="${esc(r.href)}">${rect}</a>` : rect) +
      (rows.length <= 16 ? `<text class="val" x="${cx.toFixed(1)}" y="${(T + ih - h - 5).toFixed(1)}" text-anchor="middle">${pre}${short(r.value)}</text>` : '') +
      (i % every === 0 ? `<text x="${cx.toFixed(1)}" y="${H - B + 16}" text-anchor="middle">${esc(r.label)}</text>${r.sub ? `<text x="${cx.toFixed(1)}" y="${H - B + 30}" text-anchor="middle">${esc(r.sub)}</text>` : ''}` : '');
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${bars}</svg>`;
}

/** Horizontal bars, largest first: for comparing products, people or places. rows: [{ label, value, note, href }]. */
export function barList(rows, { money = true, title = 'Chart' } = {}) {
  if (!rows.length) return '<div class="state">Nothing to show for this period.</div>';
  const W = 540, RH = 30, LW = 170, VW = 190; const max = Math.max(...rows.map(r => r.value), 1); const pre = money ? '₹' : '';
  const body = rows.map((r, i) => {
    const yy = i * RH; const w = Math.max((r.value / max) * (W - LW - VW), r.value > 0 ? 2 : 0);
    const label = r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label;
    const row = `<text x="${LW - 8}" y="${yy + 19}" text-anchor="end"><title>${esc(r.label)}</title>${esc(label)}</text>
      <rect class="cbar" x="${LW}" y="${yy + 7}" width="${w.toFixed(1)}" height="16" rx="2"><title>${esc(`${r.label}: ${pre}${r.value.toLocaleString('en-IN')}${r.note ? ' · ' + r.note : ''}`)}</title></rect>
      <text class="val" x="${(LW + w + 6).toFixed(1)}" y="${yy + 19}">${pre}${r.value.toLocaleString('en-IN')}${r.note ? ` <tspan class="note">${esc(r.note)}</tspan>` : ''}</text>`;
    return r.href ? `<a href="${esc(r.href)}">${row}</a>` : row;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${rows.length * RH + 4}" role="img" aria-label="${esc(title)}">${body}</svg>`;
}
