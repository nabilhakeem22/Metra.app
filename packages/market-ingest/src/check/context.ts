// What every validator reads: the merged bulletin with the owner's mapping and
// corrections applied, plus the published history (empty with --offline).
import { finding, type Finding } from '../findings';
import type { MarketBulletinFileV1, Months, PageV1, RowV1 } from '../format';
import type { Correction, Mapping } from '../overrides';
import type { MarketUnit } from '../units';

export interface ResolvedRow {
  row: RowV1;
  page: PageV1;
  /** The PDF page when read from the PDF, else the printed page. */
  pageId: number;
  /** The key the row publishes under: the mapping's `map` key, else proposedKey. */
  itemKey: string;
  /** The row's months after corrections. */
  months: Months;
  /** 1..12, the months a correction set. */
  correctedMonths: ReadonlySet<number>;
}

export interface PublishedItem {
  key: string;
  unit: MarketUnit;
  status: 'active' | 'discontinued';
  sourceLabels: string[];
  /** True when a published bulletin carries an observation of it. */
  hasHistory: boolean;
}

export interface EffectivePoint {
  status: 'priced' | 'suspended';
  price: string | null;
  /** 'YYYY-MM' of the bulletin that supplied it. */
  bulletinPeriod: string;
}

export interface PublishedHistory {
  items: Map<string, PublishedItem>;
  /** itemKey -> 'YYYY-MM' -> the effective point. */
  effective: Map<string, Map<string, EffectivePoint>>;
  /** Every published bulletin's period and source hashes. */
  bulletins: Array<{ period: string; pdfSha256: string | null; mdSha256: string | null }>;
}

export const EMPTY_HISTORY: PublishedHistory = { items: new Map(), effective: new Map(), bulletins: [] };

export interface CheckContext {
  file: MarketBulletinFileV1;
  /** 1..12, the bulletin's month. */
  bulletinMonth: number;
  /** Rows that publish (skipped rows excluded). */
  rows: ResolvedRow[];
  /** Item keys the mapping discontinues. */
  discontinueKeys: string[];
  corrections: Correction[];
  history: PublishedHistory;
  /** F1 threshold in percent. */
  flagPct: number;
}

export function pageIdOf(file: MarketBulletinFileV1, page: PageV1): number {
  return (file.readFrom === 'pdf' ? page.pdfPage : page.printedPage) ?? 0;
}

/** 'YYYY-MM' of month 1..12 in the bulletin's year. */
export function monthKey(file: MarketBulletinFileV1, month: number): string {
  return `${file.period.slice(0, 4)}-${String(month).padStart(2, '0')}`;
}

/** Applies mapping and corrections; a name in either file that matches no row is B0. */
export function resolveRows(
  file: MarketBulletinFileV1,
  mapping: Mapping,
  corrections: Correction[],
): { rows: ResolvedRow[]; discontinueKeys: string[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const allRowIds = new Set(file.pages.flatMap((page) => page.rows.map((row) => row.rowId)));
  for (const rowId of Object.keys(mapping)) {
    if (!allRowIds.has(rowId)) findings.push(finding('B0', `mapping.json names ${rowId}, which is not in the bulletin`, { rowId }));
  }
  for (const correction of corrections) {
    if (!allRowIds.has(correction.rowId)) {
      findings.push(finding('B0', `corrections.json names ${correction.rowId}, which is not in the bulletin`, { rowId: correction.rowId }));
    }
  }
  const rows: ResolvedRow[] = [];
  const discontinueKeys: string[] = [];
  for (const page of file.pages) {
    for (const row of page.rows) {
      const entry = mapping[row.rowId];
      if (entry?.action === 'skip') continue;
      if (entry?.action === 'discontinue') discontinueKeys.push(entry.itemKey);
      const months = [...row.months] as Months;
      const correctedMonths = new Set<number>();
      for (const correction of corrections.filter((item) => item.rowId === row.rowId)) {
        months[correction.month - 1] = correction.value;
        correctedMonths.add(correction.month);
      }
      rows.push({
        row,
        page,
        pageId: pageIdOf(file, page),
        itemKey: entry?.action === 'map' ? entry.itemKey : row.proposedKey,
        months,
        correctedMonths,
      });
    }
  }
  return { rows, discontinueKeys: [...new Set(discontinueKeys)].sort(), findings };
}
