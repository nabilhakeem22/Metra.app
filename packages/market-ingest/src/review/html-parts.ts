// The building blocks of review.html: escaping, tables, and the inline style.
// Self-contained (no external asset, no JS), RTL, like scripts/i18n/review.ts.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One cell: text is escaped; `ltr` cells hold figures, hashes and keys. */
export interface Cell {
  text: string;
  ltr?: boolean;
}

export const ltr = (text: string | number | null): Cell => ({ text: text === null ? '' : String(text), ltr: true });

function cellHtml(cell: Cell | string): string {
  const value = typeof cell === 'string' ? { text: cell } : cell;
  return value.ltr ? `<td dir="ltr" class="ltr">${escapeHtml(value.text)}</td>` : `<td>${escapeHtml(value.text)}</td>`;
}

export function table(headers: string[], rows: Array<Array<Cell | string>>): string {
  if (rows.length === 0) return '<p class="empty">None.</p>';
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map(cellHtml).join('')}</tr>`).join('\n');
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

export function section(id: string, title: string, content: string, count?: number): string {
  const badge = count === undefined ? '' : ` <span class="count">${count}</span>`;
  return `<section id="${id}"><h2>${escapeHtml(title)}${badge}</h2>\n${content}\n</section>`;
}

export const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; margin: 0; padding: 2rem; line-height: 1.5; background: #fafafa; color: #111; }
  h1 { margin: 0 0 .5rem; font-size: 1.4rem; }
  h2 { font-size: 1.1rem; border-block-end: 2px solid #ddd; padding-block-end: .35rem; margin-block-start: 2rem; }
  .count { font-size: .8rem; font-weight: 400; color: #777; margin-inline-start: .5rem; }
  .blocked { background: #fde2e1; border: 1px solid #e0a3a0; padding: .75rem 1rem; }
  .clear { background: #e3f4e5; border: 1px solid #9fcfa6; padding: .75rem 1rem; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { border: 1px solid #e2e2e2; padding: .4rem .55rem; text-align: start; vertical-align: top; }
  th { background: #f0f0f0; }
  td.ltr { font-family: ui-monospace, "Cascadia Mono", monospace; font-variant-numeric: tabular-nums; text-align: end; white-space: nowrap; }
  .empty { color: #777; font-style: italic; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e6e6e6; }
    th { background: #23262c; } th, td { border-color: #333; }
    .blocked { background: #4a1f1d; border-color: #7a3a36; }
    .clear { background: #1d3a22; border-color: #2f6a3a; }
  }
`;
