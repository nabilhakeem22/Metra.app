// Test-only: the brief's worked examples as bulletin pages, values exactly as
// the July 2026 bulletin prints them (PDF pages 7, 11, 87 and 140).
import type { Confidence, MarketBulletinFileV1, PageV1, RowV1, Slot, YearlyV1 } from '../format';
import { bulletin, months, page, printedCells } from './fixtures';

interface RowSpec {
  labelAr: string;
  specAr?: string;
  key: string;
  values: Slot[];
  confidence?: Confidence;
  rule?: string;
}

function rowsOf(pageId: number, unitLabelAr: string, specs: RowSpec[], readFrom: 'pdf' | 'md'): RowV1[] {
  return specs.map((spec, index) => {
    const slots = months(...spec.values);
    return {
      rowId: `p${pageId}.r${index + 1}`,
      proposedKey: spec.key,
      labelAr: spec.labelAr,
      specAr: spec.specAr ?? null,
      nameEn: spec.key.split('.').pop() ?? spec.key,
      specEn: null,
      unitLabelAr,
      months: slots,
      verbatimCells: readFrom === 'pdf' ? printedCells(slots) : null,
      mdTokens: readFrom === 'md' ? spec.values.filter((value) => value !== null).reverse().join(' ') : null,
      confidence: spec.confidence ?? 'read',
      rule: spec.rule ?? null,
      notes: null,
    };
  });
}

function examplePage(pageId: number, leaf: string, unit: string, specs: RowSpec[], yearly: YearlyV1 | null, readFrom: 'pdf' | 'md'): PageV1 {
  return page({
    pdfPage: readFrom === 'pdf' ? pageId : null,
    printedPage: readFrom === 'md' ? pageId : null,
    subCategoryKey: leaf,
    headingAr: specs[0].labelAr,
    defaultUnitLabelAr: unit,
    basisNoteAr: 'الأسعار من قوائم بعض الشركات المنتجة - الأسعار شاملة الضرائب دون النقل',
    legendLabelsAr: specs.map((spec) => spec.labelAr),
    rows: rowsOf(pageId, unit, specs, readFrom),
    yearly,
  });
}

const repeat = (value: string, count: number): string[] => Array.from({ length: count }, () => value);

/** E5, printed page 2 (PDF 7): steel sections; the July yearly % prints 40 against a computed 32.5. */
export function steelSectionsPage(readFrom: 'pdf' | 'md' = 'md'): PageV1 {
  return examplePage(2, 'raw.steel', 'طن', [
    { labelAr: 'كمر ثقيل', key: 'raw.steel.heavy_beams', values: ['50000', '50000', ...repeat('57600', 5)] },
    { labelAr: 'كمر وسط', key: 'raw.steel.medium_beams', values: ['41000', '41000', '50100', ...repeat('51000', 4)] },
    { labelAr: 'كمر سيجال', key: 'raw.steel.light_beams', values: ['40000', '40000', '46000', ...repeat('48000', 4)] },
    { labelAr: 'زوايا ثقيلة', key: 'raw.steel.heavy_angles', values: ['45500', '45500', '52050', ...repeat('54000', 4)] },
  ], {
    rowId: 'p2.r2',
    previousYear: months(...repeat('38000', 3), ...repeat('38500', 7), '41000', '41000'),
    printedPct: ['8', '8', '32', '32', '32', '32', '40', null, null, null, null, null],
    printedAverage: '38792',
  }, readFrom);
}

/**
 * E3, printed page 6 (PDF 11): admixtures. The PDF prints July EMPTY on every row
 * (a `read` gap); the MD shows 6 values, so read from the MD the gap is an R7 inference.
 */
export function admixturesPage(readFrom: 'pdf' | 'md' = 'md'): PageV1 {
  const fromMd = readFrom === 'md';
  const spec = (labelAr: string, key: string, values: string[]): RowSpec => ({
    labelAr, key, values, ...(fromMd ? { confidence: 'inferred' as const, rule: 'R7' } : {}),
  });
  return examplePage(6, 'raw.concrete_admixtures', 'كجم', [
    spec('مادة لزيادة قابلية التشغيل', 'raw.concrete_admixtures.workability', ['26.12', '26.12', '27.687', '30.455', '30.455', '30.455']),
    spec('مادة لزيادة قابلية التشغيل للخرسانة GRC', 'raw.concrete_admixtures.workability_grc', ['41.855', '41.855', '46.786', '51.462', '51.462', '51.462']),
    spec('مادة لتقليل النفاذية ومقاومة الأملاح', 'raw.concrete_admixtures.permeability', ['23.384', '23.384', '24.793', '27.272', '27.272', '27.272']),
    spec('مادة لاصقة للخرسانة متعددة الأغراض', 'raw.concrete_admixtures.bonding', ['90.623', '90.623', '96.966', '106.66', '106.66', '106.66']),
    spec('حبيبات لعمل خرسانة خفيفة', 'raw.concrete_admixtures.lightweight_beads', ['180.95', '180.95', ...repeat('199.04', 4)]),
    spec('ألياف فايبر جلاس لإنتاج خرسانة GRC', 'raw.concrete_admixtures.glass_fibre', ['104.18', '104.18', ...repeat('114.61', 4)]),
  ], {
    rowId: 'p6.r1',
    previousYear: months(...repeat('26.12', 12)),
    printedPct: ['0', '0', '6', '17', '17', '17', '17', null, null, null, null, null],
    printedAverage: '26',
  }, readFrom);
}

/** E4, printed page 65 (PDF 87): glass. Read from the MD, the two reflective rows are an R6 split. */
export function glassPage(readFrom: 'pdf' | 'md' = 'md'): PageV1 {
  const fromMd = readFrom === 'md';
  const split = fromMd ? { confidence: 'inferred' as const, rule: 'R6' } : {};
  return examplePage(65, 'finishing.glass', 'م2', [
    { labelAr: 'زجاج شفاف', specAr: '3 مم', key: 'finishing.glass.clear_3mm', values: ['330', '330', '433', ...repeat('399', 4)] },
    { labelAr: 'زجاج شفاف', specAr: '4 مم', key: 'finishing.glass.clear_4mm', values: ['375', '375', '513', ...repeat('467', 4)] },
    { labelAr: 'زجاج شفاف', specAr: '6 مم', key: 'finishing.glass.clear_6mm', values: ['530', '530', '707', ...repeat('661', 4)] },
    { labelAr: 'زجاج برونز فاميه', specAr: '6 مم', key: 'finishing.glass.bronze_6mm', values: ['655', '655', '912', ...repeat('855', 4)] },
    { labelAr: 'زجاج أخضر عاكس خام', specAr: '6 مم', key: 'finishing.glass.green_reflective_6mm', values: ['735', '735', fromMd ? '1026' : '969', ...repeat('912', 4)], ...split },
    { labelAr: 'زجاج أزرق فاتح عاكس خام', specAr: '6 مم', key: 'finishing.glass.blue_reflective_6mm', values: ['775', '775', fromMd ? '969' : '1026', ...repeat('969', 4)], ...split },
  ], {
    rowId: 'p65.r1',
    previousYear: months('320', '320', '320', ...repeat('340', 4), ...repeat('330', 5)),
    printedPct: ['3', '3', '35', '17', '17', '17', '17', null, null, null, null, null],
    printedAverage: '331',
  }, readFrom);
}

/** A whole file around some example pages; every other page is a justified skip. */
export function exampleFile(pages: PageV1[], readFrom: 'pdf' | 'md', lastPage: number): MarketBulletinFileV1 {
  const used = new Set(pages.map((item) => (readFrom === 'pdf' ? item.pdfPage : item.printedPage)));
  const skipped = Array.from({ length: lastPage }, (_, index) => index + 1)
    .filter((pageNumber) => !used.has(pageNumber))
    .map((pageNumber) => ({
      pdfPage: readFrom === 'pdf' ? pageNumber : null,
      printedPage: readFrom === 'md' ? pageNumber : null,
      reason: 'not part of this test',
    }));
  const base = bulletin();
  return bulletin({
    readFrom,
    source: readFrom === 'pdf'
      ? { ...base.source, pdfPageCount: lastPage, lastPrintedPage: 113 }
      : { pdfFileName: null, pdfSha256: null, pdfPageCount: null, mdFileName: 'bulletin-2026-07.md', mdSha256: 'b'.repeat(64), lastPrintedPage: lastPage },
    pages,
    skippedPages: skipped,
  });
}
