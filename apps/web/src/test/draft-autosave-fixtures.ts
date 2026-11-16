// TEST-ONLY. The drafts, receipts and stored drafts the autosave hook's tests
// are told with: one section, a Gypsum line whose quantity is the edit, and
// whatever lines a test adds after it. It imports types only and writes nothing.
import type { LineState } from '@/app/[locale]/(app)/proposals/[id]/builder-model';
import type { ProposalDraftState } from '@/app/[locale]/(app)/proposals/[id]/proposal-payload';

export function lineWith(qty: string, overrides: Partial<LineState> = {}): LineState {
  return {
    key: 'k-1',
    id: 'l-1',
    costItemId: null,
    descriptionEn: 'Gypsum',
    descriptionAr: '',
    qty,
    unit: 'sqm',
    unitCost: '60',
    unitPrice: '100',
    discountPct: '0',
    ...overrides,
  };
}

export function draftWith(qty: string, extraLines: LineState[] = []): ProposalDraftState {
  return {
    id: 'p-1',
    discountPct: '0',
    taxRate: '0',
    supervisionPct: '0',
    seeMargin: true,
    sections: [{ key: 'section-key-1', id: 's-1', titleEn: 'Ceilings', titleAr: '', lines: [lineWith(qty), ...extraLines] }],
  };
}

/** An ok answer to a save: the new revision and the id each line was stored under. */
export const receipt = (revision: string, lineIds: string[]) => ({
  ok: true,
  data: { revision, sections: [{ id: 's-1', lineIds }] },
});

const storedFigure = (figure: string) => Number(figure).toFixed(4);

/** `draft` as the server stores it and answers a read: figures to 4 places, blanks as null, its lines under `lineIds`. */
export function storedAs(draft: ProposalDraftState, revision: string, lineIds: string[]) {
  return {
    ok: true,
    data: {
      revision,
      discountPct: storedFigure(draft.discountPct),
      taxRate: storedFigure(draft.taxRate),
      supervisionPct: storedFigure(draft.supervisionPct),
      sections: draft.sections.map((section) => ({
        id: 's-1',
        titleEn: section.titleEn || null,
        titleAr: section.titleAr || null,
        lines: section.lines.map((line, index) => ({
          id: lineIds[index],
          costItemId: line.costItemId,
          descriptionEn: line.descriptionEn || null,
          descriptionAr: line.descriptionAr || null,
          qty: storedFigure(line.qty),
          unit: line.unit,
          unitPrice: storedFigure(line.unitPrice),
          discountPct: storedFigure(line.discountPct),
          unitCost: storedFigure(line.unitCost),
        })),
      })),
    },
  };
}

/** A server call that never answers. */
export const neverAnswers = () => new Promise<never>(() => undefined);
