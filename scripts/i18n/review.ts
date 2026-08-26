/**
 * i18n:review — build a self-contained review.html for a native speaker.
 *
 *   npm run i18n:review
 *
 * Side-by-side EN | current ar-EG | new (generated) ar, CHANGED ROWS ONLY (rows
 * where the generated value differs from the current one), grouped by top-level
 * namespace with high-traffic namespaces first. Arabic cells render RTL. No
 * external assets or JS — inline CSS only. Reads ar-EG.json + the generated
 * file; degrades gracefully (clear message, no crash) if the generated file is
 * absent.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { flatten } from './lib/flatten';
import {
  AR_GENERATED_PATH,
  AR_PATH,
  EN_PATH,
  REVIEW_HTML_PATH,
  readCatalog,
} from './lib/paths';

const NAMESPACE_PRIORITY = [
  'nav',
  'common',
  'errors',
  'onboarding',
  'engagements',
];

type Row = { key: string; en: string; current: string; next: string };

function namespaceOf(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

function orderNamespaces(namespaces: string[]): string[] {
  const rest = namespaces
    .filter((namespace) => !NAMESPACE_PRIORITY.includes(namespace))
    .sort((a, b) => a.localeCompare(b));
  const priority = NAMESPACE_PRIORITY.filter((namespace) =>
    namespaces.includes(namespace),
  );
  return [...priority, ...rest];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectChangedRows(): { rows: Row[]; totalGenerated: number } {
  const en = flatten(readCatalog(EN_PATH));
  const current = flatten(readCatalog(AR_PATH));
  const next = flatten(readCatalog(AR_GENERATED_PATH));
  const rows: Row[] = [];
  for (const key of Object.keys(next)) {
    const currentValue = current[key] ?? '';
    if (next[key] === currentValue) continue;
    rows.push({
      key,
      en: en[key] ?? '',
      current: currentValue,
      next: next[key],
    });
  }
  return { rows, totalGenerated: Object.keys(next).length };
}

function renderRow(row: Row): string {
  const isNew = row.current === '';
  return `<tr>
  <td class="key">${escapeHtml(row.key)}</td>
  <td class="en" dir="ltr">${escapeHtml(row.en)}</td>
  <td class="ar ${isNew ? 'added' : ''}" dir="rtl">${escapeHtml(row.current)}</td>
  <td class="ar changed" dir="rtl">${escapeHtml(row.next)}</td>
</tr>`;
}

function renderGroup(namespace: string, rows: Row[]): string {
  const body = rows.map(renderRow).join('\n');
  return `<section>
  <h2>${escapeHtml(namespace)} <span class="count">${rows.length} changed</span></h2>
  <table>
    <thead><tr><th>key</th><th>en</th><th>current ar-EG</th><th>new ar</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
</section>`;
}

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; line-height: 1.5; background: #fafafa; color: #111; }
  header { margin-block-end: 2rem; }
  h1 { margin: 0 0 .25rem; font-size: 1.4rem; }
  .summary { color: #555; }
  section { margin-block-end: 2.5rem; }
  h2 { font-size: 1.1rem; border-block-end: 2px solid #ddd; padding-block-end: .35rem; }
  .count { font-size: .8rem; font-weight: 400; color: #777; margin-inline-start: .5rem; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { border: 1px solid #e2e2e2; padding: .5rem .6rem; text-align: start; vertical-align: top; }
  th { background: #f0f0f0; position: sticky; inset-block-start: 0; }
  td.key { font-family: ui-monospace, monospace; font-size: .78rem; color: #666; white-space: nowrap; }
  td.en { max-inline-size: 28rem; }
  td.ar { font-size: 1.05rem; max-inline-size: 24rem; }
  td.changed { background: #fff3cd; }
  td.added { color: #999; font-style: italic; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e6e6e6; }
    th { background: #23262c; } th, td { border-color: #333; }
    td.changed { background: #4a3f16; color: #fff8e0; }
    td.key, .summary, .count { color: #9aa0a6; }
    h2 { border-color: #333; }
  }
`;

function renderDocument(groups: string, headerSummary: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Metra i18n review — ar-EG</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>Metra i18n review — Egyptian Arabic</h1>
  <p class="summary">${headerSummary}</p>
</header>
${groups}
</body>
</html>`;
}

function main(): void {
  if (!existsSync(AR_GENERATED_PATH)) {
    console.error(
      `No generated catalog found at ${AR_GENERATED_PATH}.\n` +
        'Run `npm run i18n:translate` first (needs GEMINI_API_KEY). ' +
        'Nothing to review yet.',
    );
    process.exit(1);
  }

  const { rows, totalGenerated } = collectChangedRows();
  if (rows.length === 0) {
    const html = renderDocument(
      '<section><p>No changed rows — the generated catalog is identical to the current ar-EG.json.</p></section>',
      `0 changed of ${totalGenerated} keys.`,
    );
    writeFileSync(REVIEW_HTML_PATH, html, 'utf8');
    console.log(`No changes. Wrote ${REVIEW_HTML_PATH} (empty review).`);
    return;
  }

  const byNamespace = new Map<string, Row[]>();
  for (const row of rows) {
    const namespace = namespaceOf(row.key);
    let group = byNamespace.get(namespace);
    if (!group) {
      group = [];
      byNamespace.set(namespace, group);
    }
    group.push(row);
  }
  const orderedNamespaces = orderNamespaces([...byNamespace.keys()]);
  const groups = orderedNamespaces
    .map((namespace) => renderGroup(namespace, byNamespace.get(namespace)!))
    .join('\n');

  const summary =
    `${rows.length} changed of ${totalGenerated} keys across ` +
    `${orderedNamespaces.length} namespaces. Yellow = new/changed Arabic.`;
  writeFileSync(REVIEW_HTML_PATH, renderDocument(groups, summary), 'utf8');
  console.log(
    `Wrote ${REVIEW_HTML_PATH} — ${rows.length} changed rows across ` +
      `${orderedNamespaces.length} namespaces.`,
  );
}

main();
