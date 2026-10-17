// The sections of review.html, in the plan's order (C6.4): header, counts,
// blocking, the PDF confirmation list, flags, per-category diff, new items,
// dropped items, applied corrections.
import { monthKey, type CheckContext, type PublishedHistory, type ResolvedRow } from '../check/context';
import { FINDING_TITLES, isBlocking, type Finding, type FindingCode } from '../findings';
import { percentChange } from '../percent';
import { describePack } from '../roll-pack';
import { marketUnitOf } from '../units';
import { escapeHtml, ltr, section, table, type Cell } from './html-parts';

export interface ReviewInput {
  period: string;
  findings: Finding[];
  context: CheckContext | null;
  stagedSha256: string;
  history: PublishedHistory;
  offline: boolean;
}

const at = (item: Finding): Cell[] => [ltr(item.page), ltr(item.rowId), ltr(item.month)];
const nameOf = (resolved: ResolvedRow) => [resolved.row.labelAr, resolved.row.specAr].filter(Boolean).join(' ');
const unitOf = (resolved: ResolvedRow) => {
  const reading = marketUnitOf(resolved.row.unitLabelAr);
  return reading === null ? resolved.row.unitLabelAr : reading.pack ? `${reading.unit} ${describePack(reading.pack)}` : reading.unit;
};

export function headerSection(input: ReviewInput): string {
  const source = input.context?.file.source;
  const blocking = input.findings.filter(isBlocking).length;
  const verdict = blocking === 0
    ? '<p class="clear">Nothing blocks. Approve this extraction_sha256 to publish.</p>'
    : `<p class="blocked">${blocking} blocking finding(s): publish refuses until the Blocking section is empty.</p>`;
  const rows: Array<Array<Cell | string>> = [
    ['period', ltr(input.period)],
    ['read from', ltr(input.context?.file.readFrom ?? 'unknown (the file did not pass the guard)')],
    ['PDF', ltr(source?.pdfFileName ?? '-')],
    ['PDF sha256', ltr(source?.pdfSha256 ?? '-')],
    ['MD', ltr(source?.mdFileName ?? '-')],
    ['MD sha256', ltr(source?.mdSha256 ?? '-')],
    ['extraction_sha256', ltr(input.stagedSha256)],
    ['history', input.offline ? 'offline: B6, B7, B11, F2 and F3 did not run' : 'checked against the published bulletins'],
  ];
  return `<h1>Market bulletin review ${escapeHtml(input.period)}</h1>\n${verdict}\n${table(['field', 'value'], rows)}`;
}

export function countsSection(input: ReviewInput): string {
  const rows = input.context?.rows ?? [];
  const confidence = (value: string) => String(rows.filter((resolved) => resolved.row.confidence === value).length);
  const codes = (Object.keys(FINDING_TITLES) as FindingCode[])
    .map((code): [FindingCode, number] => [code, input.findings.filter((item) => item.code === code).length])
    .filter(([, count]) => count > 0)
    .map(([code, count]) => [ltr(code), FINDING_TITLES[code], ltr(count)]);
  return section('counts', 'Counts', [
    table(['rows', 'read', 'inferred', 'unreadable'], [[ltr(rows.length), ltr(confidence('read')), ltr(confidence('inferred')), ltr(confidence('unreadable'))]]),
    table(['code', 'finding', 'count'], codes),
  ].join('\n'));
}

export function blockingSection(input: ReviewInput): string {
  const blocking = input.findings.filter(isBlocking);
  return section('blocking', 'Blocking (must be empty)', table(['code', 'page', 'row', 'month', 'message'], blocking.map((item) => [ltr(item.code), ...at(item), item.message])), blocking.length);
}

export function confirmSection(input: ReviewInput): string {
  const rows = new Map((input.context?.rows ?? []).map((resolved) => [resolved.row.rowId, resolved]));
  const months = input.context?.bulletinMonth ?? 12;
  const listed = input.findings.filter((item) => item.code === 'B9' || item.code === 'F10');
  const body = listed.map((item) => {
    const resolved = item.rowId === null ? undefined : rows.get(item.rowId);
    const seen = resolved?.row.verbatimCells?.slice(0, months).map((cell) => cell ?? '-').join(' | ') ?? resolved?.row.mdTokens ?? '';
    const chosen = resolved ? resolved.months.slice(0, months).map((slot) => slot ?? '-').join(' | ') : '';
    return [ltr(item.code), ltr(item.page), ltr(item.rowId), resolved ? nameOf(resolved) : '', seen, ltr(chosen), ltr(resolved?.row.rule ?? ''), resolved?.row.notes ?? item.message];
  });
  return section('confirm', 'To confirm against the PDF', table(['code', 'page', 'row', 'item', 'printed / MD', 'values', 'rule', 'notes'], body), listed.length);
}

export function flagsSection(input: ReviewInput): string {
  const flags = input.findings.filter((item) => !isBlocking(item) && !['F3', 'F4', 'F10'].includes(item.code));
  return section('flags', 'Flags (F1 to F11)', table(['code', 'flag', 'page', 'row', 'month', 'message'], flags.map((item) => [ltr(item.code), FINDING_TITLES[item.code], ...at(item), item.message])), flags.length);
}

/** The newest month this file prices, against the newest published price before it. */
function diffRow(input: ReviewInput, resolved: ResolvedRow): Array<Cell | string> {
  const context = input.context as CheckContext;
  const index = resolved.months.map((slot) => slot !== null && slot !== 'suspended').lastIndexOf(true);
  const current = index === -1 ? null : (resolved.months[index] as string);
  const published = [...(input.history.effective.get(resolved.itemKey) ?? new Map()).entries()]
    .filter(([, point]) => point.status === 'priced')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .pop();
  const change = published && current ? percentChange(published[1].price, current) : null;
  return [
    ltr(resolved.itemKey), nameOf(resolved), ltr(unitOf(resolved)),
    ltr(published ? `${published[1].price} (${published[0]})` : '-'),
    ltr(current === null ? '-' : `${current} (${monthKey(context.file, index + 1)})`),
    ltr(change === null ? '-' : `${change}%`), ltr(resolved.pageId),
  ];
}

export function diffSection(input: ReviewInput): string {
  const rows = input.context?.rows ?? [];
  const categories = [...new Set(rows.map((resolved) => resolved.page.subCategoryKey))];
  const parts = categories.map((category) => `<h3 dir="ltr">${escapeHtml(category)}</h3>\n${table(
    ['key', 'item', 'unit', 'published', 'this bulletin', 'change', 'page'],
    rows.filter((resolved) => resolved.page.subCategoryKey === category).map((resolved) => diffRow(input, resolved)),
  )}`);
  return section('diff', 'Per-category diff', parts.join('\n') || '<p class="empty">None.</p>', rows.length);
}

export function listSection(input: ReviewInput, code: 'F3' | 'F4', id: string, title: string): string {
  const listed = input.findings.filter((item) => item.code === code);
  return section(id, title, table(['page', 'row', 'message'], listed.map((item) => [ltr(item.page), ltr(item.rowId), item.message])), listed.length);
}

export function correctionsSection(input: ReviewInput): string {
  const corrections = input.context?.corrections ?? [];
  return section('corrections', 'Applied corrections', table(['row', 'month', 'value', 'reason'], corrections.map((item) => [ltr(item.rowId), ltr(item.month), ltr(item.value ?? 'empty'), item.reason])), corrections.length);
}
