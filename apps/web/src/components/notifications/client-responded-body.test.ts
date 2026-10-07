// Every client act's notification, rendered through the REAL catalogues with
// next-intl's own translator, in both locales: non-empty, carrying the delivery's
// DE- number and title, Latin digits only, and no dash. The body keys and the
// `client_responded` kind are walked from their unions, so a key added to the
// list without copy fails here instead of rendering an empty line in the bell.
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import ar from '@/messages/ar-EG.json';
import {
  CLIENT_RESPONDED_BODY_KEYS,
  NOTIFICATION_KINDS,
} from '@/lib/notifications/kinds';
import { notificationBody, type FeedItem } from './feed-item';

const CATALOGUES = { en, 'ar-EG': ar } as const;
const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;

function render(locale: keyof typeof CATALOGUES, bodyKey: string, params: Record<string, unknown>) {
  const translate = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: 'notifications.body',
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const milestones = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: 'engagements.milestoneKind',
  }) as unknown as (key: string) => string;
  const item: FeedItem = {
    id: 'n-1',
    kind: 'client_responded',
    bodyKey,
    params,
    entityType: 'engagement',
    entityId: 'e-1',
    createdAt: '2026-10-07T10:00:00Z',
    read: false,
  };
  return notificationBody(item, translate, (iso) => iso, locale, (kind) =>
    kind === 'deposit' ? milestones(kind) : null,
  );
}

const DELIVERY = { number: 12, year: 2026, titleAr: 'مطبخ الفيلا', titleEn: 'Villa kitchen', count: 1 };

describe('client_responded bodies', () => {
  for (const locale of ['en', 'ar-EG'] as const) {
    it.each(CLIENT_RESPONDED_BODY_KEYS)(`${locale}: %s names the delivery`, (bodyKey) => {
      const body = render(locale, bodyKey, DELIVERY);
      expect(body.length).toBeGreaterThan(0);
      expect(body).toContain('DE-2026-0012');
      expect(body).toContain(locale === 'en' ? 'Villa kitchen' : 'مطبخ الفيلا');
      expect(ARABIC_INDIC.test(body)).toBe(false);
      expect(DASH.test(body)).toBe(false);
    });
  }

  it('a title missing in the reader language falls back to the other', () => {
    expect(render('en', 'client_design_approved', { ...DELIVERY, titleEn: null })).toContain('مطبخ الفيلا');
    expect(render('ar-EG', 'client_design_approved', { ...DELIVERY, titleAr: '' })).toContain('Villa kitchen');
  });

  it('a payment claim names its milestone when it knows it, and still reads without one', () => {
    expect(render('en', 'client_payment_claimed', { ...DELIVERY, milestoneKind: 'deposit' })).toContain('(Deposit)');
    expect(render('ar-EG', 'client_payment_claimed', { ...DELIVERY, milestoneKind: 'deposit' })).toContain('(عربون)');
    const unknown = render('en', 'client_payment_claimed', { ...DELIVERY, milestoneKind: 'mystery' });
    expect(unknown).not.toContain('(');
    expect(unknown).toContain('DE-2026-0012');
  });

  it('a payment row counted twice still names its milestone: rows are per milestone since 0057', () => {
    // A count above 1 is the SAME milestone claimed again (the notifier keeps one
    // unread row per milestone), so the sentence names it rather than a total.
    expect(render('en', 'client_payment_claimed', { ...DELIVERY, milestoneKind: 'deposit', count: 2 })).toContain(
      '(Deposit)',
    );
    const arabic = render('ar-EG', 'client_payment_claimed', { ...DELIVERY, milestoneKind: 'deposit', count: 3 });
    expect(arabic).toContain('(عربون)');
    expect(ARABIC_INDIC.test(arabic)).toBe(false);
    expect(DASH.test(arabic)).toBe(false);
  });

  it('a chosen concept option reads as its letter, and generically without one (B12)', () => {
    expect(render('en', 'client_concept_chosen', { ...DELIVERY, optionPosition: 2 })).toContain('option ⁨B⁩');
    expect(render('ar-EG', 'client_concept_chosen', { ...DELIVERY, optionPosition: 2 })).toContain('البديل ⁨B⁩');
    for (const optionPosition of [undefined, 0, 5, '2', 1.5]) {
      const generic = render('en', 'client_concept_chosen', { ...DELIVERY, optionPosition });
      expect(generic).toContain('a concept option');
      expect(generic).not.toMatch(/option [A-D]/);
    }
    expect(render('ar-EG', 'client_concept_chosen', DELIVERY)).toContain('بديل للفكرة');
  });

  it('repeated comments say how many, in Latin digits', () => {
    expect(render('en', 'client_commented', { ...DELIVERY, count: 3 })).toContain('3 comments');
    const arabic = render('ar-EG', 'client_commented', { ...DELIVERY, count: 3 });
    expect(arabic).toContain('3');
    expect(ARABIC_INDIC.test(arabic)).toBe(false);
    expect(render('en', 'client_commented', DELIVERY)).toContain('a comment');
  });

  it('every notification kind has its label in both catalogues', () => {
    for (const catalogue of [en, ar]) {
      for (const kind of NOTIFICATION_KINDS) {
        expect(typeof catalogue.notifications.kinds[kind], kind).toBe('string');
      }
    }
  });
});
