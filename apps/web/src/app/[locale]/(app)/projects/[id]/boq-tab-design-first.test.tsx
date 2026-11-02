import { act, fireEvent, screen } from '@testing-library/react';
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
  startBoqVersion,
}));
vi.mock('@/lib/contracts/actions', () => ({ generateExecutionContract: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const startBoqVersion = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => [] as Array<{ title?: string; variant?: string }>);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { title?: string; variant?: string }) => {
    toasts.push(raised);
  },
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

function renderTabResult(locale: TestLocale, status: string, execution: BoqExecution, issueNeedsDelivery = false) {
  return renderWithIntl(
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

function renderTab(locale: TestLocale, status: string, execution: BoqExecution, issueNeedsDelivery = false): void {
  renderTabResult(locale, status, execution, issueNeedsDelivery);
}

describe.each<TestLocale>(['en', 'ar-EG'])('the BOQ tab (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const sentence = (key: string) => at(`errors.${key}`).replace('{delivery}', TARGET.delivery);
  const createButton = () => screen.queryByRole('button', { name: at('contracts.execution.generate.open') });
  const deliveryLink = () => screen.queryByRole('link', { name: at('contracts.designFirst.openDelivery').replace('{delivery}', TARGET.delivery) });

  test.each(['design_open', 'design_only_closed'] as const)('%s: no Create, the sentence, and the link', (code) => {
    renderTab(locale, 'issued', { contractId: null, canGenerate: true, refusal: { code, params: TARGET }, canStartVersion: false });
    expect(createButton()).toBeNull();
    expect(screen.getByText(sentence(code))).toBeTruthy();
    expect(deliveryLink()?.getAttribute('href')).toContain('/engagements/delivery-9');
  });

  test('boq_not_on_home: no Create, the sentence, and no link', () => {
    renderTab(locale, 'issued', { contractId: null, canGenerate: true, refusal: { code: 'boq_not_on_home' }, canStartVersion: false });
    expect(createButton()).toBeNull();
    expect(screen.getByText(sentence('boq_not_on_home'))).toBeTruthy();
    expect(deliveryLink()).toBeNull();
  });

  test('at the home with no contract: Create', () => {
    renderTab(locale, 'issued', { contractId: null, canGenerate: true, refusal: null, canStartVersion: false });
    expect(createButton()).toBeTruthy();
  });

  test('with a contract: Open contract, and no Create', () => {
    renderTab(locale, 'issued', { contractId: 'contract-1', canGenerate: true, refusal: null, canStartVersion: false });
    expect(createButton()).toBeNull();
    expect(screen.getByRole('link', { name: at('contracts.execution.generate.openContract') }).getAttribute('href')).toContain('/contracts/contract-1');
  });

  const newVersion = () => screen.queryByRole('button', { name: at('projects.profile.boq.newVersion') });

  test('boq_delivery_abandoned: no Create, no New version, the sentence and no link', () => {
    renderTab(locale, 'issued', { contractId: null, canGenerate: true, refusal: { code: 'boq_delivery_abandoned' }, canStartVersion: false });
    expect(createButton()).toBeNull();
    expect(newVersion()).toBeNull();
    expect(screen.getByText(sentence('boq_delivery_abandoned'))).toBeTruthy();
    expect(deliveryLink()).toBeNull();
  });

  test('New version shows beside the refusal that names it, beside Create, and beside Open contract', () => {
    const { unmount } = renderTabResult(locale, 'issued', { contractId: null, canGenerate: true, refusal: { code: 'boq_not_on_home' }, canStartVersion: true });
    expect(newVersion()).toBeTruthy();
    expect(screen.getByText(sentence('boq_not_on_home'))).toBeTruthy();
    expect(sentence('boq_not_on_home')).toContain(at('projects.profile.boq.newVersion'));
    unmount();
    const beside = renderTabResult(locale, 'issued', { contractId: null, canGenerate: true, refusal: null, canStartVersion: true });
    expect(newVersion()).toBeTruthy();
    expect(createButton()).toBeTruthy();
    beside.unmount();
    renderTab(locale, 'issued', { contractId: 'contract-1', canGenerate: true, refusal: null, canStartVersion: true });
    expect(newVersion()).toBeTruthy();
    expect(screen.getByRole('link', { name: at('contracts.execution.generate.openContract') })).toBeTruthy();
  });

  test('no New version without its condition, nor on the draft shown over an issued BOQ', () => {
    const { unmount } = renderTabResult(locale, 'issued', { contractId: 'contract-1', canGenerate: true, refusal: null, canStartVersion: false });
    expect(newVersion()).toBeNull();
    unmount();
    renderTab(locale, 'draft', { contractId: null, canGenerate: false, refusal: null, canStartVersion: true });
    expect(newVersion()).toBeNull();
    expect(createButton()).toBeNull();
    expect((screen.getByRole('button', { name: at('projects.profile.boq.issue') }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(at('projects.profile.boq.statusDraft'))).toBeTruthy();
  });

  test('pressing it starts the version from the BOQ on screen; a refusal says its cause', async () => {
    startBoqVersion.mockReset();
    toasts.length = 0;
    startBoqVersion.mockResolvedValueOnce({ ok: true, data: 'boq-2' }).mockResolvedValueOnce({ ok: false, error: 'boq_has_contract' });
    renderTab(locale, 'issued', { contractId: null, canGenerate: true, refusal: null, canStartVersion: true });
    fireEvent.click(newVersion()!);
    await act(async () => {});
    expect(startBoqVersion).toHaveBeenCalledWith('boq-1');
    expect(toasts).toEqual([]);
    fireEvent.click(newVersion()!);
    await act(async () => {});
    expect(toasts).toEqual([{ title: at('errors.boq_has_contract'), variant: 'destructive' }]);
  });

  test('a draft with no delivery: Issue is off and the note says why', () => {
    renderTab(locale, 'draft', { contractId: null, canGenerate: false, refusal: null, canStartVersion: false }, true);
    expect((screen.getByRole('button', { name: at('projects.profile.boq.issue') }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(at('errors.boq_needs_delivery'))).toBeTruthy();
  });

  test('a draft with a delivery: Issue is on and there is no note', () => {
    renderTab(locale, 'draft', { contractId: null, canGenerate: false, refusal: null, canStartVersion: false });
    expect((screen.getByRole('button', { name: at('projects.profile.boq.issue') }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(at('errors.boq_needs_delivery'))).toBeNull();
  });
});
