// Shared view-model for the proposal builder: the editable line/section shapes,
// the unit list, the array-move helper, and the live line preview. Server-safe
// (types + pure helpers only) so both the parent client component and its child
// client components can import it.
import { coerceMoneyInput, computeLine } from '@/lib/aggregates/proposal-totals';

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
  'h-9 glass-field outline-none focus-ring-brand focus-visible:border-[color:hsl(var(--brand))] px-2 text-sm';

export function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

// Live preview must match persistence: input the server would reject -> 0.
export function previewLine(l: LineState) {
  return computeLine({
    qty: coerceMoneyInput(l.qty),
    unitCost: coerceMoneyInput(l.unitCost),
    unitPrice: coerceMoneyInput(l.unitPrice),
    discountPct: coerceMoneyInput(l.discountPct),
  });
}
