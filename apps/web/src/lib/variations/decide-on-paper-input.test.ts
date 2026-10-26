import { describe, expect, it } from 'vitest';
import { paperDecisionFieldErrors, readPaperDecision } from './decide-on-paper-input';

const TODAY = '2026-10-26';

describe('readPaperDecision', () => {
  it('reads an answer, a day up to today in Cairo and a trimmed note', () => {
    expect(readPaperDecision({ decision: 'reject', decidedOn: ' 2026-10-26 ', note: '  On site  ' }, TODAY)).toEqual({
      ok: true,
      values: { decision: 'reject', decidedOn: '2026-10-26', note: 'On site' },
    });
    expect(readPaperDecision({ decision: 'approve', decidedOn: '2026-10-01', note: '   ' }, TODAY)).toEqual({
      ok: true,
      values: { decision: 'approve', decidedOn: '2026-10-01', note: null },
    });
  });

  it('takes no answer but approve or reject, and no day after today', () => {
    for (const decision of [undefined, null, '', 'approved', 'APPROVE', 1]) {
      expect(paperDecisionFieldErrors({ decision, decidedOn: TODAY }, TODAY), String(decision)).toEqual({
        decision: { code: 'required' },
      });
    }
    expect(paperDecisionFieldErrors({ decision: 'approve', decidedOn: '2026-10-27' }, TODAY)).toEqual({
      decidedOn: { code: 'date_in_future' },
    });
  });

  it('caps the note at 500 characters', () => {
    expect(paperDecisionFieldErrors({ decision: 'approve', decidedOn: TODAY, note: 'x'.repeat(500) }, TODAY)).toEqual({});
    expect(paperDecisionFieldErrors({ decision: 'approve', decidedOn: TODAY, note: 'x'.repeat(501) }, TODAY)).toEqual({
      note: { code: 'too_long', params: { max: 500 } },
    });
  });
});
