import { describe, expect, it } from 'vitest';
import { parseLostActs } from './lost-acts';

const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

const NOTIFIED = {
  engagement_id: ENGAGEMENT,
  locale: 'en',
  notified_count: 2,
  new_recipients: [MEMBER],
  number: 7,
  year: 2026,
  title_ar: null,
  title_en: 'Villa',
};

describe('parseLostActs', () => {
  it('reads each repaired act with the notifier answer it carries', () => {
    expect(
      parseLostActs([
        { body_key: 'client_design_approved', milestone_kind: null, notified: NOTIFIED },
        { body_key: 'client_payment_claimed', milestone_kind: 'gate_a', notified: NOTIFIED },
      ]),
    ).toEqual([
      {
        act: { kind: 'design_approved' },
        notified: {
          engagementId: ENGAGEMENT,
          locale: 'en',
          notifiedCount: 2,
          newRecipients: [MEMBER],
          delivery: { number: 7, year: 2026, titleAr: null, titleEn: 'Villa' },
        },
      },
      expect.objectContaining({ act: { kind: 'payment_claimed', milestoneKind: 'gate_a' } }),
    ]);
  });

  it('is an empty list when nothing was lost', () => {
    expect(parseLostActs([])).toEqual([]);
  });

  it('is null when the function refused (SQL NULL) or answered no list', () => {
    expect(parseLostActs(null)).toBeNull();
    expect(parseLostActs({ body_key: 'client_commented' })).toBeNull();
  });

  it('drops an entry it cannot email, and keeps the rest', () => {
    const parsed = parseLostActs([
      null,
      'x',
      { body_key: 'client_unknown', notified: NOTIFIED },
      { body_key: 'client_payment_claimed', milestone_kind: null, notified: NOTIFIED },
      { body_key: 'client_commented', milestone_kind: null, notified: null },
      { body_key: 'client_commented', milestone_kind: null, notified: { ...NOTIFIED, engagement_id: 'nope' } },
      { body_key: 'client_commented', milestone_kind: null, notified: NOTIFIED },
    ]);
    expect(parsed?.map((entry) => entry.act)).toEqual([{ kind: 'commented' }]);
  });
});
