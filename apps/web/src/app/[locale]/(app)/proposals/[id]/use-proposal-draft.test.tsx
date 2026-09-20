import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { useProposalDraft, type ProposalDraftApi } from './use-proposal-draft';

afterEach(cleanup);

// W5 R7: two `addLine` calls in one frame lost one line. `addLine` read
// `sections` out of the RENDER CLOSURE and handed the result to `patchSection`,
// so both calls started from the same array and the second overwrote the first.
// Nothing said so — no error, no toast; the studio clicked twice and got one
// line, and on a long form would not necessarily notice which.

const DETAIL = {
  id: 'p-1',
  discountPct: '0',
  taxRate: '14',
  supervisionPct: '0',
  sections: [
    {
      id: 's-1',
      titleAr: null,
      titleEn: 'Civil',
      sortOrder: 0,
      sectionSubtotal: '0',
      lines: [],
    },
    {
      id: 's-2',
      titleAr: null,
      titleEn: 'Finishes',
      sortOrder: 1,
      sectionSubtotal: '0',
      lines: [],
    },
  ],
} as unknown as ProposalDetail;

/** The builder's draft state, with its api and every render exposed. */
function draftHarness() {
  const renders: ProposalDraftApi[] = [];
  function Probe() {
    renders.push(useProposalDraft(DETAIL));
    return null;
  }
  render(<Probe />);
  return { latest: () => renders[renders.length - 1]! };
}

describe('useProposalDraft — line edits read the LATEST state, not the render closure', () => {
  it('keeps BOTH lines when addLine is called twice in one act()', () => {
    const draft = draftHarness();

    act(() => {
      draft.latest().addLine(0);
      draft.latest().addLine(0);
    });

    // THE DEFECT: this used to be 1.
    expect(draft.latest().sections[0]!.lines).toHaveLength(2);
    expect(draft.latest().sections[1]!.lines).toHaveLength(0);
  });

  it('removes BOTH lines when removeLine is called twice in one act()', () => {
    const draft = draftHarness();
    act(() => {
      draft.latest().addLine(0);
      draft.latest().addLine(0);
      draft.latest().addLine(0);
    });
    expect(draft.latest().sections[0]!.lines).toHaveLength(3);

    act(() => {
      // Both indices are read against the array as it stood, which is what the
      // two clicks meant; the guarantee here is that neither call is LOST.
      draft.latest().removeLine(0, 2);
      draft.latest().removeLine(0, 0);
    });
    expect(draft.latest().sections[0]!.lines).toHaveLength(1);
  });

  it('adds to two DIFFERENT sections in one frame without either winning', () => {
    const draft = draftHarness();
    act(() => {
      draft.latest().addLine(0);
      draft.latest().addLine(1);
    });
    expect(draft.latest().sections[0]!.lines).toHaveLength(1);
    expect(draft.latest().sections[1]!.lines).toHaveLength(1);
  });

  it('seeds a line from the price book, and a bare one from the defaults', () => {
    const draft = draftHarness();
    act(() => {
      draft.latest().addLine(0, {
        id: 'ci-1',
        code: 'GYP-01',
        nameEn: 'Gypsum ceiling',
        nameAr: null,
        unit: 'sqm',
        defaultUnitCost: '100',
        defaultUnitPrice: '150',
      });
      draft.latest().addLine(0);
    });

    const [seeded, bare] = draft.latest().sections[0]!.lines;
    expect(seeded!.costItemId).toBe('ci-1');
    expect(seeded!.unitPrice).toBe('150');
    expect(bare!.costItemId).toBeNull();
    expect(bare!.unitPrice).toBe('0');
  });

  it('totals follow the lines, so a lost line would also be a wrong number', () => {
    const draft = draftHarness();
    act(() => {
      draft.latest().addLine(0);
      draft.latest().addLine(0);
    });
    act(() => {
      draft.latest().patchLine(0, 0, { qty: '2', unitPrice: '100' });
      draft.latest().patchLine(0, 1, { qty: '1', unitPrice: '50' });
    });
    // 2*100 + 1*50 = 250. Had the second addLine been lost, this would be 200
    // and nothing else on the screen would have said anything was missing.
    expect(Number(draft.latest().totals.doc.subtotal)).toBe(250);
  });
});
