import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClientHomeLinkResult } from '@/app/[locale]/(app)/contracts/[id]/client-home-link-result';
import { clientHomeShownOf } from '@/app/[locale]/(app)/contracts/[id]/client-home-shown';
import { ContractActionError, contractFailureOf } from '@/app/[locale]/(app)/contracts/[id]/contract-action-error';
import { ContractsClient } from '@/app/[locale]/(app)/contracts/contracts-client';
import { describeFailure, type Translate } from '@/lib/actions/error-message';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { GenerateExecutionContract } from './generate-execution-contract';
import { SignOfflineDialog } from './sign-offline-dialog';

// AC18: every surface that can receive a design-first refusal says the sentence
// with its delivery number, links to the delivery, and never shows a raw code.

const actions = vi.hoisted(() => ({
  generateContract: vi.fn(),
  generateExecutionContract: vi.fn(),
  recordContractSignedOffline: vi.fn(),
}));
vi.mock('@/lib/contracts/actions', () => actions);
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const TARGET = { delivery: 'DE-2026-0009', deliveryId: 'delivery-9' };
const REFUSED = { ok: false as const, error: 'design_open' as const, params: TARGET };

function translatorFor(locale: TestLocale): Translate {
  return (key, values) => {
    let message = messageAt(locale, `errors.${key}`);
    for (const [name, value] of Object.entries(values ?? {})) message = message.replace(`{${name}}`, String(value));
    return message;
  };
}

beforeEach(() => {
  actions.generateContract.mockResolvedValue(REFUSED);
  actions.generateExecutionContract.mockResolvedValue(REFUSED);
  actions.recordContractSignedOffline.mockResolvedValue(REFUSED);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the refusal link (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const SENTENCE = () => at('errors.design_open').replace('{delivery}', TARGET.delivery);
  const expectRefusal = () => {
    expect(document.body.textContent).toContain(SENTENCE());
    expect(document.body.textContent).not.toContain('design_open');
    const link = screen.getByRole('link', { name: at('contracts.designFirst.openDelivery').replace('{delivery}', TARGET.delivery) });
    expect(link.getAttribute('href')).toContain('/engagements/delivery-9');
    expect(link.className).toContain('min-h-11');
  };

  test('the generate sheet', async () => {
    renderWithIntl(<GenerateExecutionContract boqId="boq-1" />, { locale });
    fireEvent.click(screen.getByRole('button', { name: at('contracts.execution.generate.open') }));
    fireEvent.click(await screen.findByRole('button', { name: at('contracts.execution.generate.submit') }));
    await screen.findByRole('alert');
    expectRefusal();
  });

  test('the sign-offline dialog', async () => {
    renderWithIntl(<SignOfflineDialog contractId="contract-1" />, { locale });
    fireEvent.click(screen.getByRole('button', { name: at('contracts.execution.signOffline.open') }));
    fireEvent.click(await screen.findByRole('button', { name: at('contracts.execution.signOffline.submit') }));
    await screen.findByRole('alert');
    expectRefusal();
  });

  test("the contract page's action error", () => {
    renderWithIntl(<ContractActionError failure={contractFailureOf(REFUSED, translatorFor(locale))} />, { locale });
    expectRefusal();
  });

  test('the Client page result', () => {
    const shown = clientHomeShownOf(REFUSED, (failure) => describeFailure(failure, translatorFor(locale)));
    renderWithIntl(<ClientHomeLinkResult shown={shown} />, { locale });
    expectRefusal();
  });

  test('the contracts list', async () => {
    const proposal = { id: 'q1', number: 1, titleAr: null, titleEn: 'Quote', createdAt: '2026-06-01T10:00:00Z', issueDate: null };
    renderWithIntl(<ContractsClient items={[]} generatable={[proposal]} canManage pager={null} />, { locale });
    const generateButtons = () => screen.getAllByRole('button', { name: at('contracts.generate') });
    fireEvent.click(generateButtons()[0]);
    // In reading order: the header's button, the picker row's, the empty state's.
    fireEvent.click(generateButtons()[1]);
    await screen.findByRole('alert');
    expectRefusal();
  });

  test('any other refusal shows no link', () => {
    const failure = contractFailureOf({ ok: false, error: 'contract_not_draft' }, translatorFor(locale));
    renderWithIntl(<ContractActionError failure={failure} />, { locale });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(at('errors.contract_not_draft'));
  });
});
