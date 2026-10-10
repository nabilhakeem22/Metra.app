// Round C, owner decisions Oct 10 and fix round S1: "what your clients see was
// changed by <verified email>", rendered through the REAL catalogues.
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { notificationBody, notificationHref, type FeedItem } from './feed-item';

const CATALOGUES = { en, 'ar-EG': ar } as const;

function itemWith(params: Record<string, unknown>): FeedItem {
  return {
    id: 'n-1',
    kind: 'client_page_details_changed',
    bodyKey: 'client_page_details_changed',
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

const ACTOR = { actorUserId: 'u-1', fields: ['bankIban'], actor: { name: 'Sara', email: 'sara@studio.test' } };

describe('client_page_details_changed', () => {
  it('names the actor by verified email with the name beside it, in both locales', () => {
    expect(render('en', ACTOR)).toBe(
      'Sara (sara@studio.test) changed the contact and payment details your clients see. Check them in Settings.',
    );
    expect(render('ar-EG', ACTOR)).toBe(
      'Sara (sara@studio.test) غيّر بيانات التواصل والدفع اللي العملاء بيشوفوها. راجعها من الإعدادات.',
    );
  });

  it('never trusts a stored name: only the resolved actor speaks', () => {
    expect(render('en', { actorUserId: 'u-1', changedBy: 'The owner, approved', fields: [] })).toBe(
      'The contact and payment details your clients see were changed. Check them in Settings.',
    );
    expect(render('en', { ...ACTOR, actor: { name: 'Sara', email: null } })).toBe(
      'The contact and payment details your clients see were changed. Check them in Settings.',
    );
  });

  it('opens the card in Settings', () => {
    expect(notificationHref(itemWith({}))).toBe('/settings#client-page');
  });
});
