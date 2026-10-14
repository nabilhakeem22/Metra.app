import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ContractDetail } from '@/lib/contracts/queries';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractsClient } from '../contracts-client';
import { ContractDetailClient } from './contract-detail-client';
import { ContractHeaderForm } from './contract-header-form';
import { VariationRegister } from './variation-register';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const contracts = vi.hoisted(() => ({
  generateContract: vi.fn(),
  saveContractDraft: vi.fn(),
  issueContract: vi.fn(),
  terminateContract: vi.fn(),
}));
vi.mock('@/lib/contracts/actions', () => contracts);
const variations = vi.hoisted(() => ({
  createVariationDraft: vi.fn(),
  saveVariationDraft: vi.fn(),
  internalApproveVariation: vi.fn(),
  issueVariation: vi.fn(),
}));
vi.mock('@/lib/variations/actions', () => variations);

const DETAIL = {
  id: 'k-1',
  status: 'draft',
  signatureDate: null,
  startDate: null,
  endDate: null,
  advancePct: '10',
  retentionPct: '5',
  paymentTermsDays: null,
  defectsLiabilityDays: null,
  termsEn: null,
  termsAr: null,
  originalValue: '1000.0000',
  revisedValue: '1000.0000',
  sections: [],
} as unknown as ContractDetail;

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

/** The sentence is the catalogue's, and the raw code is nowhere on the page. */
function expectSaid(locale: TestLocale, code: string) {
  expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, `errors.${code}`));
  expect(document.body.textContent).not.toContain(code);
}

describe.each<TestLocale>(['en', 'ar-EG'])('contract screens say the cause, not the code (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('the header form answered contract_not_draft', async () => {
    contracts.saveContractDraft.mockResolvedValue({ ok: false, error: 'contract_not_draft' });
    renderWithIntl(<ContractHeaderForm detail={DETAIL} />, { locale });
    await press(at('contracts.saveDraft'));
    expectSaid(locale, 'contract_not_draft');
  });

  test('issuing from the detail page answered contract_not_draft', async () => {
    contracts.issueContract.mockResolvedValue({ ok: false, error: 'contract_not_draft' });
    renderWithIntl(
      <ContractDetailClient
        detail={DETAIL}
        variations={[]}
        canManage={false}
        canIssue
        canDraftVariation={false}
        canPriceVariation={false}
      />,
      { locale },
    );
    await press(at('contracts.issue'));
    expectSaid(locale, 'contract_not_draft');
  });

  test('generating a contract answered contract_exists', async () => {
    contracts.generateContract.mockResolvedValue({ ok: false, error: 'contract_exists' });
    const proposal = { id: 'p-1', number: 7, titleAr: null, titleEn: 'Villa', issueDate: null, createdAt: '2026-01-01' };
    renderWithIntl(<ContractsClient items={[]} generatable={[proposal]} canManage />, { locale });
    fireEvent.click(screen.getAllByRole('button', { name: at('contracts.generate') })[0]);
    const row = screen.getByText('Villa').parentElement!;
    await act(async () => {
      fireEvent.click(row.querySelector('button')!);
    });
    expectSaid(locale, 'contract_exists');
  });

  test.each([
    ['creating the variation', 'contract_not_issued', { ok: false, error: 'contract_not_issued' }, null],
    ['saving its lines', 'variation_not_draft', { ok: true, data: 'v-1' }, { ok: false, error: 'variation_not_draft' }],
  ])('the variation register, %s refused', async (_step, code, created, saved) => {
    variations.createVariationDraft.mockResolvedValue(created);
    variations.saveVariationDraft.mockResolvedValue(saved);
    renderWithIntl(
      <VariationRegister
        contractId="k-1"
        contractStatus="issued"
        variations={[]}
        baselineLines={[]}
        canDraftVariation
        canPriceVariation={false}
        pending={false}
        m={(v) => v}
        act={() => {}}
      />,
      { locale },
    );
    await press(at('variations.create'));
    fireEvent.change(screen.getByPlaceholderText(at('variations.title_')), { target: { value: 'Extra door' } });
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '')!);
    await press(at('variations.saveDraft'));
    expectSaid(locale, code);
  });

  test('a rejected action says the server failed, with its digest as the reference', async () => {
    contracts.saveContractDraft.mockRejectedValue(Object.assign(new Error('boom'), { digest: '4242' }));
    renderWithIntl(<ContractHeaderForm detail={DETAIL} />, { locale });
    await press(at('contracts.saveDraft'));
    expect(screen.getByRole('alert').textContent).toBe(
      `${at('errors.generic')} ${at('errors.reference').replace('{reference}', '4242')}`,
    );
  });
});
