// Shared view-model for the proposal builder: the editable line/section shapes,
// the unit list, the array-move helper, and the live line preview. Server-safe
// (types + pure helpers only) so both the parent client component and its child
// client components can import it.
import { coerceMoneyInput, computeLine } from '@/lib/aggregates/proposal-totals';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';

export interface CostItemOption {
  id: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  unit: string;
  defaultUnitCost: string;
  defaultUnitPrice: string;
}

export interface LineState {
  /** This session's handle on the row, never sent: how a save's receipt finds
   *  the line it gave an id to, however the rows moved meanwhile. */
  key: string;
  id: string | null;
  costItemId: string | null;
  descriptionEn: string;
  descriptionAr: string;
  qty: string;
  unit: string;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
}

export interface SectionState {
  titleEn: string;
  titleAr: string;
  lines: LineState[];
}

export const UNITS = ['sqm', 'linear_meter', 'pcs', 'lump_sum', 'day'];

export const INPUT_CLASS =
  'h-9 glass-field outline-none focus-ring-brand focus-visible:border-[color:hsl(var(--brand))] px-2';

export function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

let lastLineKey = 0;

/** A fresh `LineState.key`, unique within this page. */
export function newLineKey(): string {
  lastLineKey += 1;
  return `line-${lastLineKey}`;
}

/** A typed figure as it will be saved (see decimal-input.ts). */
export const figureOf = normalizeDecimalInput;

// Live preview must match persistence: input the server would reject -> 0.
export function previewLine(l: LineState) {
  return computeLine({
    qty: coerceMoneyInput(figureOf(l.qty)),
    unitCost: coerceMoneyInput(figureOf(l.unitCost)),
    unitPrice: coerceMoneyInput(figureOf(l.unitPrice)),
    discountPct: coerceMoneyInput(figureOf(l.discountPct)),
  });
}
