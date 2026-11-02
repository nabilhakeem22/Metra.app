import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { BoqDetail } from '@/lib/boqs/queries';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BoqTab } from './boq-tab';
import type { BoqExecution } from './boq-tab-sheet';

// AC13 and AC14: an issued BOQ offers Create only at the pair's home. Anywhere else
// the sentence and the link replace the button. A draft with no delivery has
// Issue off and the note, not a button that can only be refused.

vi.mock('@/lib/boqs/actions', () => ({
  addBoqLine: vi.fn(),
  addBoqSection: vi.fn(),
  setBoqDiscount: vi.fn(),
  updateBoqLine: vi.fn(),
  deleteBoqLine: vi.fn(),
  issueBoq: vi.fn(),
}));
vi.mock('@/lib/contracts/actions', () => ({ generateExecutionContract: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const BOQ = {
  id: 'boq-1',
  number: 1,
  documentNumber: 'BQ-2026-0001',
  version: 1,
  title: 'BOQ',
  source: 'manual',
  currency: 'EGP',
  discountPct: '0.0000',
  subtotal: '100.0000',
  discountAmount: '0.0000',
  total: '100.0000',
  lineCount: 0,
  sections: [],
};

const TARGET = { delivery: 'DE-2026-0009', deliveryId: 'delivery-9' };

function renderTab(locale: TestLocale, status: string, execution: BoqExecution, issueNeedsDelivery = false) {
  renderWithIntl(
    <BoqTab
      projectId="p1"
      boq={{ ...BOQ, status, lineCount: status === 'draft' ? 1 : 0 } as BoqDetail}
      canBuild
      canSeeCost={false}
      clientCanOpenOnIssue={false}
      issueNeedsDelivery={issueNeedsDelivery}
      issueBlockedByContract={false}
      execution={execution}
    />,
    { locale },
  );
}

describe.each<TestLocale>(['en', 'ar-EG'])('the BOQ tab (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const sentence = (key: string) => at(`errors.${key}`).replace('{delivery}', TARGET.delivery);
  const createButton = () => screen.queryByRole('button', { name: at('contracts.execution.generate.open') });
  const deliveryLink = () => screen.queryByRole('link', { name: at('contracts.designFirst.openDelivery').replace('{delivery}', TARGET.delivery) });

  test.each(['design_open', 'design_only_closed'] as const)('%s: no Create, the sentence, and the link', (code) => {
    renderTab(locale, 'issued', { contractId: null, canGenerate: true, refusal: { code, params: TARGET } });
    expect(createButton()).toBeNull();
    expect(screen.getByText(sentence(code))).toBeTruthy();
    expect(deliveryLink()?.getAttribute('href')).toContain('/engagements/delivery-9');
  });

  test('boq_not_on_home: no Create, the sentence, and no link', () => {
    renderTab(locale, 'issued', { contractId: null, canGenerate: true, refusal: { code: 'boq_not_on_home' } });
    expect(createButton()).toBeNull();
    expect(screen.getByText(sentence('boq_not_on_home'))).toBeTruthy();
    expect(deliveryLink()).toBeNull();
  });

  test('at the home with no contract: Create', () => {
    renderTab(locale, 'issued', { contractId: null, canGenerate: true, refusal: null });
    expect(createButton()).toBeTruthy();
  });

  test('with a contract: Open contract, and no Create', () => {
    renderTab(locale, 'issued', { contractId: 'contract-1', canGenerate: true, refusal: null });
    expect(createButton()).toBeNull();
    expect(screen.getByRole('link', { name: at('contracts.execution.generate.openContract') }).getAttribute('href')).toContain('/contracts/contract-1');
  });

  test('a draft with no delivery: Issue is off and the note says why', () => {
    renderTab(locale, 'draft', { contractId: null, canGenerate: false, refusal: null }, true);
    expect((screen.getByRole('button', { name: at('projects.profile.boq.issue') }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(at('errors.boq_needs_delivery'))).toBeTruthy();
  });

  test('a draft with a delivery: Issue is on and there is no note', () => {
    renderTab(locale, 'draft', { contractId: null, canGenerate: false, refusal: null });
    expect((screen.getByRole('button', { name: at('projects.profile.boq.issue') }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(at('errors.boq_needs_delivery'))).toBeNull();
  });
});
