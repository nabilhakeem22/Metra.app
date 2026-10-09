import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PublicDeliveryView } from './public-delivery';

// The client page's frame: the studio bar with the language switch (also on the
// notices), the cards in order, the budget whenever a range is issued, and 44 px
// targets on everything a finger can press.

vi.mock('./actions', () => ({}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

function delivery(overrides: Partial<PublicDelivery> = {}): PublicDelivery {
  return {
    id: 'de-1',
    number: 7,
    stageKey: 'finalApproval',
    milestone: { index: 3, allComplete: false, closed: false },
    hero: { kind: 'action', group: 'design', showRomAck: false },
    offPlan: false,
    titleAr: 'شقة الزمالك',
    titleEn: 'Zamalek flat',
    createdAt: '2026-01-01T00:00:00Z',
    designFeeTotal: '120000.0000',
    rom: { low: '900000.0000', high: '1200000.0000' },
    shareExpiresAt: null,
    firm: { nameAr: 'ديوان', nameEn: 'Diwan Studio', logoFileId: null },
    client: { nameAr: 'أحمد', nameEn: 'Ahmed' },
    paymentSchedule: [
      { milestone_kind: 'deposit', basis: 'amount', amount_due: '36000.0000', amount_cleared: '0.0000', status: 'due' },
    ],
    paymentClaim: { claimableMilestones: [{ milestoneKind: 'deposit', amountRemaining: '36000.0000', hasPendingClaim: false }] },
    documents: [{ id: DOCUMENT_ID, category: 'render', sharedAt: '2026-02-01T00:00:00Z', commentCount: 0, access: 'download' }],
    clientActions: ['approve_design', 'request_design_changes'],
    conceptOptions: [],
    conceptChoice: null,
    conceptDecision: null,
    ...overrides,
  };
}

function renderPage(locale: TestLocale, overrides: Partial<PublicDelivery> = {}) {
  return renderWithIntl(
    <PublicDeliveryView token="tok-1" read={{ status: 'ok', delivery: delivery(overrides) }} />,
    { locale },
  );
}

const switchLink = (locale: TestLocale) =>
  screen.getByRole('link', { name: messageAt(locale, 'delivery.language.switchTo') });

describe('the studio bar', () => {
  it('names the studio and switches to the same delivery in Arabic, with no query', () => {
    renderPage('en');
    const bar = screen.getByRole('banner');
    expect(within(bar).getByText('Diwan Studio')).toBeTruthy();
    const link = switchLink('en');
    expect(link.textContent).toBe('العربية');
    expect(link.getAttribute('href')).toBe('/ar-EG/d/tok-1');
    expect(link.getAttribute('hreflang')).toBe('ar');
  });

  it('on the Arabic page it switches to English', () => {
    renderPage('ar-EG');
    expect(within(screen.getByRole('banner')).getByText('ديوان')).toBeTruthy();
    const link = switchLink('ar-EG');
    expect(link.textContent).toBe('English');
    expect(link.getAttribute('href')).toBe('/en/d/tok-1');
  });
});

describe('the notices', () => {
  it.each([
    ['not_found', 'notFound'],
    ['read_failed', 'readFailed'],
  ] as const)('%s keeps the language switch inside its card', (status, notice) => {
    renderWithIntl(<PublicDeliveryView token="deadbeef" read={{ status }} />, { locale: 'ar-EG' });
    expect(screen.getByRole('heading').textContent).toBe(messageAt('ar-EG', `delivery.${notice}.title`));
    expect(switchLink('ar-EG').getAttribute('href')).toBe('/en/d/deadbeef');
  });

  it('F13: a token Next handed over still encoded is encoded once in the switch', () => {
    renderWithIntl(<PublicDeliveryView token="dead%20beef" read={{ status: 'not_found' }} />, { locale: 'en' });
    expect(switchLink('en').getAttribute('href')).toBe('/ar-EG/d/dead%20beef');
  });
});

describe('the page', () => {
  it('shows the budget whenever a range is issued, with no button when it is not offered', () => {
    renderPage('en');
    expect(screen.getByText(messageAt('en', 'delivery.budget.title'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') })).toBeNull();
  });

  it('F14: a long project title keeps to one line (the full title stays in `title`)', () => {
    const long = 'Zamalek flat, full interior fit-out with kitchen, three bathrooms and the roof terrace';
    renderPage('en', { titleEn: long });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).toContain('truncate');
    expect(heading.getAttribute('title')).toBe(long);
  });

  it('has no budget card without an issued range', () => {
    renderPage('en', { rom: null });
    expect(screen.queryByText(messageAt('en', 'delivery.budget.title'))).toBeNull();
  });

  it('documents open inline in a new tab, and download stays plain', () => {
    renderPage('en');
    const view = screen.getByRole('link', { name: messageAt('en', 'delivery.documents.view') });
    expect(view.getAttribute('href')).toBe(`/en/d/tok-1/documents/${DOCUMENT_ID}?variant=view`);
    expect(view.getAttribute('target')).toBe('_blank');
    expect(view.getAttribute('rel')).toBe('noopener noreferrer');
    const download = screen.getByRole('link', { name: messageAt('en', 'delivery.documents.download') });
    expect(download.getAttribute('href')).toBe(`/en/d/tok-1/documents/${DOCUMENT_ID}`);
    expect(download.hasAttribute('target')).toBe(false);
  });

  it('every link and button is at least 44 px tall on touch, and no field sets its own text size', () => {
    const { container } = renderPage('ar-EG');
    const pressable = [...container.querySelectorAll('.client-portal a, .client-portal button')];
    expect(pressable.length).toBeGreaterThan(5);
    for (const element of pressable) {
      expect(element.className, element.textContent ?? '').toMatch(/(^|\s)(coarse:)?min-h-11(\s|$)/);
    }
    for (const field of container.querySelectorAll('.client-portal input, .client-portal textarea')) {
      expect(field.className).not.toMatch(/(^|\s)text-(caption|small|body|xs|sm|base)(\s|$)/);
    }
  });
});
