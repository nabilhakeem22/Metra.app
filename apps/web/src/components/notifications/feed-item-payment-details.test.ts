// Round C, owner decision Oct 10: "payment details were changed by <name>",
// rendered through the REAL catalogues with next-intl's own translator.
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { notificationBody, notificationHref, type FeedItem } from './feed-item';

const CATALOGUES = { en, 'ar-EG': ar } as const;

function itemWith(params: Record<string, unknown>): FeedItem {
  return {
    id: 'n-1',
    kind: 'payment_details_changed',
    bodyKey: 'payment_details_changed',
    params,
    entityType: 'organization',
    entityId: 'org-1',
    createdAt: '2026-10-10T05:00:00Z',
    read: false,
  };
}

function render(locale: keyof typeof CATALOGUES, params: Record<string, unknown>) {
  const translate = createTranslator({ locale, messages: CATALOGUES[locale], namespace: 'notifications.body' });
  return notificationBody(
    itemWith(params),
    translate as unknown as (key: string, values?: Record<string, string | number>) => string,
    (iso) => iso,
    locale,
    () => null,
  );
}

describe('payment_details_changed', () => {
  it('names who changed the payment details, in both locales', () => {
    expect(render('en', { changedBy: 'Nabil', fields: ['bankIban'] })).toBe(
      'Nabil changed the payment details your clients see. Check them in Settings.',
    );
    expect(render('ar-EG', { changedBy: 'نبيل', fields: ['bankIban'] })).toBe(
      'نبيل غيّر بيانات الدفع اللي العملاء بيشوفوها. راجعها من الإعدادات.',
    );
  });

  it('reads without a name when none was stored', () => {
    expect(render('en', { changedBy: null })).toBe(
      'The payment details your clients see were changed. Check them in Settings.',
    );
    expect(render('ar-EG', {})).toBe('بيانات الدفع اللي العملاء بيشوفوها اتغيّرت. راجعها من الإعدادات.');
  });

  it('opens the card in Settings', () => {
    expect(notificationHref(itemWith({}))).toBe('/settings#client-page');
  });
});
