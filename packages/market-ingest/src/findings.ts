// What every validator reports. B = BLOCKING (publish refuses while one
// remains); F = FLAG (listed in review.html, the owner judges).
import { byCodePoint } from './order';

export const BLOCKING_CODES = [
  'B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12',
] as const;
export const FLAG_CODES = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11',
] as const;

export type BlockingCode = (typeof BLOCKING_CODES)[number];
export type FlagCode = (typeof FLAG_CODES)[number];
export type FindingCode = BlockingCode | FlagCode;

/** One-line titles, shown in the CLI summary and review.html. */
export const FINDING_TITLES: Record<FindingCode, string> = {
  B0: 'Format',
  B1: 'Slots',
  B2: 'Values',
  B3: 'Units',
  B4: 'Taxonomy',
  B5: 'Uniqueness',
  B6: 'Unit stability',
  B7: 'Identity clash',
  B8: 'Coverage',
  B9: 'Unresolved reading',
  B10: 'Rule cited',
  B11: 'Source reuse',
  B12: 'Verbatim mismatch',
  F1: 'Jump',
  F2: 'Restatement',
  F3: 'Dropped item',
  F4: 'New item',
  F5: 'Suspended',
  F6: 'Basis differs',
  F7: 'Row count',
  F8: 'Yearly disagreement',
  F9: 'Average disagreement',
  F10: 'Inferred',
  F11: 'Sibling pattern',
};

export interface Finding {
  code: FindingCode;
  rowId: string | null;
  /** The page the finding is about: the PDF page when read from the PDF, else the printed page. */
  page: number | null;
  /** 1..12 when the finding is about one month. */
  month: number | null;
  message: string;
}

export function isBlocking(finding: Finding): boolean {
  return finding.code.startsWith('B');
}

export function finding(
  code: FindingCode,
  message: string,
  at: { rowId?: string | null; page?: number | null; month?: number | null } = {},
): Finding {
  return { code, rowId: at.rowId ?? null, page: at.page ?? null, month: at.month ?? null, message };
}

/** Stable order: code family, then page, row and month. Findings are data, so order is part of the hash. */
export function sortFindings(findings: Finding[]): Finding[] {
  const codeRank = (code: FindingCode) =>
    (code.startsWith('B') ? 0 : 100) + Number(code.slice(1));
  return [...findings].sort(
    (a, b) =>
      codeRank(a.code) - codeRank(b.code) ||
      (a.page ?? 0) - (b.page ?? 0) ||
      byCodePoint(a.rowId ?? '', b.rowId ?? '') ||
      (a.month ?? 0) - (b.month ?? 0) ||
      byCodePoint(a.message, b.message),
  );
}
