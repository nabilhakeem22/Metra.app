// Test-only builders for `metra.market-bulletin.v1` files. The default is a
// small VALID bulletin read from a 3-page PDF: page 1 a cover, page 2 the rebar
// table of July 2026 (worked example E1), page 3 a company directory.
import type { MarketBulletinFileV1, Months, PageV1, RowV1, Slot, VerbatimCells } from '../format';

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/** A months tuple from Jan.. values; missing entries are null. */
export function months(...values: Slot[]): Months {
  return Array.from({ length: 12 }, (_, index) => values[index] ?? null) as Months;
}

/** The cells as the PDF prints them: Arabic-Indic digits, «،» as the decimal mark. */
export function printedCells(slots: Months): VerbatimCells {
  return slots.map((slot) => {
    if (slot === null) return null;
    if (slot === 'suspended') return 'التسعير متوقف';
    return slot.replace(/[0-9]/g, (digit) => ARABIC_INDIC[Number(digit)]).replace('.', '،');
  }) as VerbatimCells;
}

export function row(overrides: Partial<RowV1> = {}): RowV1 {
  const slots = overrides.months ?? months('38200', '38200', '38200', '39850', '39850', '39850', '39850');
  return {
    rowId: 'p2.r1',
    proposedKey: 'raw.steel.rebar',
    labelAr: 'حديد التسليح',
    specAr: null,
    nameEn: 'Reinforcing steel',
    specEn: null,
    unitLabelAr: 'طن',
    months: slots,
    verbatimCells: printedCells(slots),
    mdTokens: null,
    confidence: 'read',
    rule: null,
    notes: null,
    ...overrides,
  };
}

export function page(overrides: Partial<PageV1> = {}): PageV1 {
  return {
    pdfPage: 2,
    printedPage: 1,
    subCategoryKey: 'raw.steel',
    headingAr: 'حديد التسليح',
    defaultUnitLabelAr: 'طن',
    basisNoteAr: 'الأسعار للمستهلك لكميات لا تقل عن 30 طن شاملة الضرائب دون النقل',
    basis: { includesTaxes: true, includesTransport: false, minimumQuantityAr: null },
    suspendedNoteAr: null,
    legendLabelsAr: ['حديد التسليح'],
    rows: [row()],
    yearly: {
      rowId: 'p2.r1',
      previousYear: months(...Array.from({ length: 12 }, () => '38200')),
      printedPct: ['0', '0', '0', '4', '4', '4', '4', null, null, null, null, null],
      printedAverage: '38200',
    },
    ...overrides,
  };
}

export function bulletin(overrides: Partial<MarketBulletinFileV1> = {}): MarketBulletinFileV1 {
  return {
    format: 'metra.market-bulletin.v1',
    publisher: 'mhuc_cabm',
    period: '2026-07',
    source: {
      pdfFileName: 'bulletin-2026-07.pdf',
      pdfSha256: 'a'.repeat(64),
      pdfPageCount: 3,
      mdFileName: null,
      mdSha256: null,
      lastPrintedPage: 1,
    },
    readFrom: 'pdf',
    producedBy: 'fixture',
    pages: [page()],
    skippedPages: [
      { pdfPage: 1, printedPage: null, reason: 'cover' },
      { pdfPage: 3, printedPage: null, reason: 'company directory' },
    ],
    ...overrides,
  };
}

/** A deep copy as plain JSON, for tests that break the shape on purpose. */
export function asJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}
