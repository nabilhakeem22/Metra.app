// THE NORMATIVE DEFINITION of `metra.market-bulletin.v1`: the one JSON file an
// extracting Claude Code session writes per bulletin (docs/market-price-book/
// EXTRACTION.md copies these types verbatim). The session is an UNTRUSTED
// producer; guard.ts checks the shape and src/check/* check the meaning.

export const MARKET_BULLETIN_FORMAT = 'metra.market-bulletin.v1';

/** `^[0-9]+(\.[0-9]{1,4})?$`: Western digits, no grouping, no sign. */
export type Decimal = string;

/** One month: a price, an empty cell, or a «التسعير متوقف» stamp. */
export type Slot = Decimal | null | 'suspended';

/** Index 0 = January. Twelve slots, always. */
export type Months = [Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot, Slot];

/** One cell's text exactly as printed, Jan..Dec. Arabic-Indic digits are allowed HERE ONLY. */
export type VerbatimCells = [
  string | null, string | null, string | null, string | null, string | null, string | null,
  string | null, string | null, string | null, string | null, string | null, string | null,
];

export type ReadFrom = 'pdf' | 'md';

export type Confidence = 'read' | 'inferred' | 'unreadable';

/** The reading rules of the brief; a non-`read` row must cite one. */
export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'] as const;

export interface MarketBulletinFileV1 {
  format: typeof MARKET_BULLETIN_FORMAT;
  publisher: 'mhuc_cabm';
  /** 'YYYY-MM', the bulletin month. */
  period: string;
  source: SourceV1;
  /** Which file the values were READ from. The other one, when given, was only a hint. */
  readFrom: ReadFrom;
  /** Free text, e.g. 'Claude Code session 2026-10-20, EXTRACTION.md v1'. */
  producedBy: string;
  /** One per PRICE page, ascending page. */
  pages: PageV1[];
  /** Directories, covers, TOC: with `pages`, they account for every page exactly once. */
  skippedPages: SkippedPageV1[];
}

export interface SourceV1 {
  pdfFileName: string | null;
  /** sha256 of the PDF exactly as received. */
  pdfSha256: string | null;
  /** The PDF's page count (145 for July 2026). Required with a PDF. */
  pdfPageCount: number | null;
  mdFileName: string | null;
  /** sha256 of the MD exactly as received. */
  mdSha256: string | null;
  /** The highest page number printed under a PRICE table (113 for July 2026). */
  lastPrintedPage: number;
}

export interface PageV1 {
  /** 1-based page index in the PDF. Required when readFrom = 'pdf'. */
  pdfPage: number | null;
  /** The number printed under the table. Required when readFrom = 'md'. NOT unique in a PDF. */
  printedPage: number | null;
  /** A taxonomy leaf, e.g. 'raw.cement'. */
  subCategoryKey: string;
  /** Page title in logical order, e.g. 'الأسمنت'. */
  headingAr: string;
  /** The unit cell when one unit spans all rows, e.g. 'طن'. */
  defaultUnitLabelAr: string | null;
  /** The price-basis line, logical order. */
  basisNoteAr: string;
  basis: { includesTaxes: boolean; includesTransport: boolean; minimumQuantityAr: string | null };
  /** e.g. 'التسعير متوقف نظرا للظروف الاقتصادية'. */
  suspendedNoteAr: string | null;
  /** The item names under the chart, logical order: the row-count cross-check. */
  legendLabelsAr: string[];
  rows: RowV1[];
  /** The '2025-2026 change' side table, when the page has one. */
  yearly: YearlyV1 | null;
}

export interface SkippedPageV1 {
  pdfPage: number | null;
  printedPage: number | null;
  reason: string;
}

export interface RowV1 {
  /** 'p<page>.r<n>': page = pdfPage when readFrom = 'pdf', else printedPage; n from 1, top to bottom. */
  rowId: string;
  /** `^[a-z0-9_]+(\.[a-z0-9_]+){2,}$`, starts with subCategoryKey; REUSE the catalogue key. */
  proposedKey: string;
  labelAr: string;
  specAr: string | null;
  nameEn: string;
  specEn: string | null;
  /** The unit for THIS row, logical order, Western digits (copy defaultUnitLabelAr when shared). */
  unitLabelAr: string;
  /** The 2026 table only, Western digits. */
  months: Months;
  /** The cells as printed. Required when readFrom = 'pdf'. */
  verbatimCells: VerbatimCells | null;
  /** The exact MD fragment the values came from. Required when readFrom = 'md'. */
  mdTokens: string | null;
  confidence: Confidence;
  /** Required unless 'read': the brief rule (R1..R10) that decided. */
  rule: string | null;
  notes: string | null;
}

export interface YearlyV1 {
  /** The charted row this table describes. */
  rowId: string;
  /** The previous-year column. */
  previousYear: Months;
  /** 12 entries as printed ('23', '-8', '2.4'); null where blank. */
  printedPct: (string | null)[];
  /** The printed 'المتوسط' (the PREVIOUS-year average). */
  printedAverage: Decimal | null;
}
