import { describe, expect, it } from 'vitest';
import type { LineState, SectionState } from './builder-model';
import { storedIdsByKey, withStoredIds } from './draft-save-receipt';
import { buildProposalPayload } from './proposal-payload';

function line(key: string, id: string | null): LineState {
  return {
    key,
    id,
    costItemId: null,
    descriptionEn: 'Gypsum',
    descriptionAr: '',
    qty: '1',
    unit: 'sqm',
    unitCost: '60',
    unitPrice: '100',
    discountPct: '0',
  };
}

function section(key: string, id: string | null, lines: LineState[]): SectionState {
  return { key, id, titleEn: 'Ceilings', titleAr: '', lines };
}

describe('the save receipt, adopted by key', () => {
  it('maps every saved section and line key to the id it was stored under', () => {
    const saved = [section('section-1', 'S1', [line('line-1', 'L1')]), section('section-2', null, [line('line-2', null)])];
    const ids = storedIdsByKey(saved, {
      revision: '1',
      sections: [
        { id: 'S1', lineIds: ['L1'] },
        { id: 'S2', lineIds: ['L2'] },
      ],
    });
    expect([...ids]).toEqual([
      ['section-1', 'S1'],
      ['line-1', 'L1'],
      ['section-2', 'S2'],
      ['line-2', 'L2'],
    ]);
  });

  it('a section added during the save keeps no id; a stored one adopts its id and keeps unchanged lines', () => {
    const storedLine = line('line-1', 'L1');
    const current = [section('section-new', null, []), section('section-2', null, [storedLine])];
    const adopted = withStoredIds(current, new Map([['section-2', 'S2']]));
    expect(adopted[0]).toBe(current[0]);
    expect(adopted[1].id).toBe('S2');
    expect(adopted[1].lines).toBe(current[1].lines);
  });

  it('rows that already carry their ids are returned as they are', () => {
    const current = [section('section-1', 'S1', [line('line-1', 'L1')])];
    expect(withStoredIds(current, new Map([['section-1', 'S1'], ['line-1', 'L1']]))[0]).toBe(current[0]);
  });

  it('the payload sends each section by its stored id, and a new section with none', () => {
    const payload = buildProposalPayload({
      id: 'p-1',
      discountPct: '0',
      taxRate: '0',
      supervisionPct: '0',
      seeMargin: true,
      sections: [section('section-1', 'S1', []), section('section-2', null, [])],
    });
    expect(payload.sections.map((entry) => entry.id)).toEqual(['S1', null]);
  });
});
