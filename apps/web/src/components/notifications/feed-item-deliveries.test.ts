// Round C, C4, AC 15 and AC 16: the delivery follow-up and the digest's delivery
// counts, rendered through the REAL catalogues with next-intl's own translator.
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { deliveryLabelOf } from './delivery-label';
import { notificationBody, type FeedItem } from './feed-item';

const CATALOGUES = { en, 'ar-EG': ar } as const;
const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;
/** The bidi isolates (LRI, RLI, FSI, PDI) `bidiIsolate` wraps a reference in. */
const ISOLATES = /[⁦-⁩]/g;

function render(locale: keyof typeof CATALOGUES, bodyKey: string, params: Record<string, unknown>) {
  const translate = createTranslator({ locale, messages: CATALOGUES[locale], namespace: 'notifications.body' });
  const item: FeedItem = {
    id: 'n-1',
    kind: bodyKey === 'portfolio_digest' ? 'portfolio_digest' : 'delivery_followup',
    bodyKey,
    params,
    entityType: 'engagement',
    entityId: 'e-1',
    createdAt: '2026-10-09T05:00:00Z',
    read: false,
  };
  const body = notificationBody(
    item,
    translate as unknown as (key: string, values?: Record<string, string | number>) => string,
    (iso) => iso,
    locale,
    () => null,
  );
  return body.replace(ISOLATES, '');
}

const DELIVERY = { number: 12, year: 2026, titleAr: 'مطبخ الفيلا', titleEn: 'Villa kitchen' };

describe('delivery_waiting_on_client (AC 16)', () => {
  it('names the delivery and the day count in both locales, Latin digits, no dash', () => {
    const english = render('en', 'delivery_waiting_on_client', { ...DELIVERY, days: 6 });
    expect(english).toBe('DE-2026-0012 · Villa kitchen has waited on the client for 6 days. Send them a reminder.');
    const arabic = render('ar-EG', 'delivery_waiting_on_client', { ...DELIVERY, days: 6 });
    expect(arabic).toBe('DE-2026-0012 · مطبخ الفيلا مستني العميل من 6 يوم. ابعتله تذكير.');
    for (const body of [english, arabic]) {
      expect(ARABIC_INDIC.test(body)).toBe(false);
      expect(DASH.test(body)).toBe(false);
    }
  });

  it('an unknown body key still renders an empty line', () => {
    expect(render('en', 'delivery_something_new', DELIVERY)).toBe('');
  });
});

describe('the digest with deliveries (AC 15)', () => {
  const PORTFOLIO = { activeProjects: 4, awaitingResponse: 2, expiringSoon: 1, overdueStages: 0 };

  it('appends the delivery counts when the digest carries them', () => {
    const body = render('en', 'portfolio_digest', {
      ...PORTFOLIO,
      deliveriesYourMove: 3,
      deliveriesWaiting: 1,
      deliveriesStalled: 0,
    });
    expect(body).toBe(
      '4 active projects, 2 awaiting response, 1 expiring soon, 0 overdue stages. Deliveries: 3 need your move, 1 wait on the client, 0 stalled.',
    );
    expect(render('ar-EG', 'portfolio_digest', { ...PORTFOLIO, deliveriesYourMove: 3, deliveriesWaiting: 1, deliveriesStalled: 0 }))
      .toContain('التسليمات: 3 محتاجة خطوة منك، 1 مستنية العميل، 0 متعطلة.');
  });

  it('a digest written before Round C reads exactly as before', () => {
    expect(render('en', 'portfolio_digest', PORTFOLIO)).toBe(
      '4 active projects, 2 awaiting response, 1 expiring soon, 0 overdue stages.',
    );
  });
});

describe('deliveryLabelOf', () => {
  it('number and title by locale, either part optional', () => {
    expect(deliveryLabelOf(DELIVERY, 'en').replace(ISOLATES, '')).toBe('DE-2026-0012 · Villa kitchen');
    expect(deliveryLabelOf({ titleEn: 'Villa kitchen' }, 'ar-EG')).toBe('Villa kitchen');
    expect(deliveryLabelOf({ number: 12, year: 2026 }, 'en').replace(ISOLATES, '')).toBe('DE-2026-0012');
    expect(deliveryLabelOf({}, 'en')).toBe('');
  });
});
