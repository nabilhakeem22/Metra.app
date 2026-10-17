// B0/B1/B2 at the shape level: a hand-written guard for `metra.market-bulletin.v1`.
// Every key is required, no unknown key is allowed, and every value has its
// type. It reports EVERY problem it sees (not the first), and hands back the
// typed file only when there is none.
import type { Finding } from './findings';
import { MARKET_BULLETIN_FORMAT, type MarketBulletinFileV1 } from './format';
import { ShapeReader, type ShapeContext } from './guard-shape';

const FILE_KEYS = ['format', 'publisher', 'period', 'source', 'readFrom', 'producedBy', 'pages', 'skippedPages'];
const SOURCE_KEYS = ['pdfFileName', 'pdfSha256', 'pdfPageCount', 'mdFileName', 'mdSha256', 'lastPrintedPage'];
const PAGE_KEYS = [
  'pdfPage', 'printedPage', 'subCategoryKey', 'headingAr', 'defaultUnitLabelAr', 'basisNoteAr',
  'basis', 'suspendedNoteAr', 'legendLabelsAr', 'rows', 'yearly',
];
const BASIS_KEYS = ['includesTaxes', 'includesTransport', 'minimumQuantityAr'];
const ROW_KEYS = [
  'rowId', 'proposedKey', 'labelAr', 'specAr', 'nameEn', 'specEn', 'unitLabelAr', 'months',
  'verbatimCells', 'mdTokens', 'confidence', 'rule', 'notes',
];
const YEARLY_KEYS = ['rowId', 'previousYear', 'printedPct', 'printedAverage'];
const SKIPPED_KEYS = ['pdfPage', 'printedPage', 'reason'];

export const PERIOD_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const PRINTED_PCT = /^-?[0-9]+(\.[0-9])?$/;

export type GuardResult =
  | { ok: true; file: MarketBulletinFileV1 }
  | { ok: false; findings: Finding[] };

type ReadFromValue = 'pdf' | 'md' | null;

export function guardBulletinFile(value: unknown): GuardResult {
  const reader = new ShapeReader();
  const at: ShapeContext = { path: '$' };
  if (reader.object(value, FILE_KEYS, at)) {
    if (value.format !== MARKET_BULLETIN_FORMAT) reader.fail('B0', at, `format must be "${MARKET_BULLETIN_FORMAT}"`);
    reader.oneOf(value.publisher, ['mhuc_cabm'], { path: '$.publisher' });
    if (typeof value.period !== 'string' || !PERIOD_PATTERN.test(value.period)) {
      reader.fail('B0', { path: '$.period' }, 'expected "YYYY-MM"');
    }
    reader.oneOf(value.readFrom, ['pdf', 'md'], { path: '$.readFrom' });
    const readFrom = value.readFrom === 'pdf' || value.readFrom === 'md' ? value.readFrom : null;
    checkSource(reader, value.source, readFrom);
    reader.text(value.producedBy, { path: '$.producedBy' }, { nonEmpty: true });
    checkList(reader, value.pages, '$.pages', (page, path) => checkPage(reader, page, path, readFrom));
    checkList(reader, value.skippedPages, '$.skippedPages', (skipped, path) => {
      if (!reader.object(skipped, SKIPPED_KEYS, { path })) return;
      reader.positiveInteger(skipped.pdfPage, { path: `${path}.pdfPage` }, true);
      reader.positiveInteger(skipped.printedPage, { path: `${path}.printedPage` }, true);
      reader.text(skipped.reason, { path: `${path}.reason` }, { nonEmpty: true });
    });
  }
  if (reader.findings.length > 0) return { ok: false, findings: reader.findings };
  return { ok: true, file: value as MarketBulletinFileV1 };
}

function checkList(reader: ShapeReader, value: unknown, path: string, each: (item: unknown, path: string) => void): void {
  if (!Array.isArray(value)) {
    reader.fail('B0', { path }, 'expected an array');
    return;
  }
  value.forEach((item, index) => each(item, `${path}[${index}]`));
}

function checkSource(reader: ShapeReader, source: unknown, readFrom: ReadFromValue): void {
  const at = { path: '$.source' };
  if (!reader.object(source, SOURCE_KEYS, at)) return;
  reader.text(source.pdfFileName, { path: '$.source.pdfFileName' }, { nullable: true, nonEmpty: true });
  reader.sha256(source.pdfSha256, { path: '$.source.pdfSha256' });
  reader.positiveInteger(source.pdfPageCount, { path: '$.source.pdfPageCount' }, true);
  reader.text(source.mdFileName, { path: '$.source.mdFileName' }, { nullable: true, nonEmpty: true });
  reader.sha256(source.mdSha256, { path: '$.source.mdSha256' });
  reader.positiveInteger(source.lastPrintedPage, { path: '$.source.lastPrintedPage' });
  if ((source.pdfFileName === null) !== (source.pdfSha256 === null)) {
    reader.fail('B0', at, 'pdfFileName and pdfSha256 are given together or not at all');
  }
  if ((source.mdFileName === null) !== (source.mdSha256 === null)) {
    reader.fail('B0', at, 'mdFileName and mdSha256 are given together or not at all');
  }
  if (readFrom === 'pdf' && (source.pdfSha256 === null || source.pdfPageCount === null)) {
    reader.fail('B0', at, 'readFrom "pdf" needs pdfFileName, pdfSha256 and pdfPageCount');
  }
  if (readFrom === 'md' && source.mdSha256 === null) {
    reader.fail('B0', at, 'readFrom "md" needs mdFileName and mdSha256');
  }
}

function checkPage(reader: ShapeReader, page: unknown, path: string, readFrom: ReadFromValue): void {
  if (!reader.object(page, PAGE_KEYS, { path })) return;
  const pageId = readFrom === 'pdf' ? page.pdfPage : page.printedPage;
  const at: ShapeContext = { path, page: typeof pageId === 'number' ? pageId : null };
  reader.positiveInteger(page.pdfPage, { ...at, path: `${path}.pdfPage` }, readFrom !== 'pdf');
  reader.positiveInteger(page.printedPage, { ...at, path: `${path}.printedPage` }, readFrom !== 'md');
  reader.text(page.subCategoryKey, { ...at, path: `${path}.subCategoryKey` }, { nonEmpty: true });
  reader.text(page.headingAr, { ...at, path: `${path}.headingAr` }, { nonEmpty: true , displayed: true });
  reader.text(page.defaultUnitLabelAr, { ...at, path: `${path}.defaultUnitLabelAr` }, { nullable: true, nonEmpty: true , displayed: true });
  reader.text(page.basisNoteAr, { ...at, path: `${path}.basisNoteAr` }, { nonEmpty: true , displayed: true });
  if (reader.object(page.basis, BASIS_KEYS, { ...at, path: `${path}.basis` })) {
    reader.boolean(page.basis.includesTaxes, { ...at, path: `${path}.basis.includesTaxes` });
    reader.boolean(page.basis.includesTransport, { ...at, path: `${path}.basis.includesTransport` });
    reader.text(page.basis.minimumQuantityAr, { ...at, path: `${path}.basis.minimumQuantityAr` }, { nullable: true, nonEmpty: true , displayed: true });
  }
  reader.text(page.suspendedNoteAr, { ...at, path: `${path}.suspendedNoteAr` }, { nullable: true, nonEmpty: true , displayed: true });
  reader.stringArray(page.legendLabelsAr, { ...at, path: `${path}.legendLabelsAr` });
  checkList(reader, page.rows, `${path}.rows`, (row, rowPath) => checkRow(reader, row, { ...at, path: rowPath }, readFrom));
  if (page.yearly !== null) checkYearly(reader, page.yearly, { ...at, path: `${path}.yearly` });
}

function checkRow(reader: ShapeReader, row: unknown, pageAt: ShapeContext, readFrom: ReadFromValue): void {
  if (!reader.object(row, ROW_KEYS, pageAt)) return;
  const at: ShapeContext = { ...pageAt, rowId: typeof row.rowId === 'string' ? row.rowId : null };
  const field = (name: string): ShapeContext => ({ ...at, path: `${pageAt.path}.${name}` });
  const rowIdPattern = new RegExp(`^p${pageAt.page ?? '[1-9][0-9]*'}\\.r[1-9][0-9]*$`);
  if (typeof row.rowId !== 'string' || !rowIdPattern.test(row.rowId)) {
    reader.fail('B0', field('rowId'), `expected "p${pageAt.page ?? '<page>'}.r<n>"`);
  }
  reader.text(row.proposedKey, field('proposedKey'), { nonEmpty: true });
  reader.text(row.labelAr, field('labelAr'), { nonEmpty: true , displayed: true });
  reader.text(row.specAr, field('specAr'), { nullable: true, nonEmpty: true , displayed: true });
  reader.text(row.nameEn, field('nameEn'), { nonEmpty: true , displayed: true });
  reader.text(row.specEn, field('specEn'), { nullable: true, nonEmpty: true , displayed: true });
  reader.text(row.unitLabelAr, field('unitLabelAr'), { nonEmpty: true , displayed: true });
  reader.twelve(row.months, field('months'), (slot, month) => {
    if (slot !== null && slot !== 'suspended') reader.decimal(slot, field(`months[${month - 1}]`), month);
  });
  if (row.verbatimCells !== null || readFrom === 'pdf') {
    reader.twelve(row.verbatimCells, field('verbatimCells'), (cell, month) =>
      reader.text(cell, field(`verbatimCells[${month - 1}]`), { nullable: true }),
    );
  }
  reader.text(row.mdTokens, field('mdTokens'), { nullable: readFrom !== 'md', nonEmpty: true });
  reader.oneOf(row.confidence, ['read', 'inferred', 'unreadable'], field('confidence'));
  reader.text(row.rule, field('rule'), { nullable: true, nonEmpty: true });
  reader.text(row.notes, field('notes'), { nullable: true });
}

function checkYearly(reader: ShapeReader, yearly: unknown, at: ShapeContext): void {
  if (!reader.object(yearly, YEARLY_KEYS, at)) return;
  const field = (name: string): ShapeContext => ({ ...at, path: `${at.path}.${name}` });
  reader.text(yearly.rowId, field('rowId'), { nonEmpty: true });
  reader.twelve(yearly.previousYear, field('previousYear'), (slot, month) => {
    if (slot !== null && slot !== 'suspended') reader.decimal(slot, field(`previousYear[${month - 1}]`), month);
  });
  reader.twelve(yearly.printedPct, field('printedPct'), (pct, month) => {
    if (pct !== null && (typeof pct !== 'string' || !PRINTED_PCT.test(pct))) {
      reader.fail('B2', field(`printedPct[${month - 1}]`), 'expected "23", "-8" or "2.4" (Western digits) or null', month);
    }
  });
  if (yearly.printedAverage !== null) reader.decimal(yearly.printedAverage, field('printedAverage'));
}
