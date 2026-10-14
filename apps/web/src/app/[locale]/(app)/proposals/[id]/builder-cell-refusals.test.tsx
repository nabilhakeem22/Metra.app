// W2.6: the builder says each refusal under the cell it is about, keyed by row.
// Autosave only marks (D4: the caret stays where the studio is, AC 30b); an
// explicit Send moves the caret to the first refused cell.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ProposalBuilder } from './builder-client';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => router,
}));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/en/proposals/p-1',
}));
const boqActions = vi.hoisted(() => ({ sendProposalAsBoq: vi.fn() }));
vi.mock('@/lib/boq-proposals/actions', () => boqActions);
const proposalActions = vi.hoisted(() => ({ saveProposalDraft: vi.fn(), autosaveProposalDraft: vi.fn() }));
vi.mock('@/lib/proposals/actions', () => ({
  ...proposalActions,
  deleteDraftProposal: vi.fn(),
  sendProposal: vi.fn(),
  getProposalPreviewHtml: vi.fn(),
}));
vi.mock('@/lib/sections/actions', () => ({ addSection: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const DETAIL = {
  id: 'p-1',
  revision: '1789000000000000',
  number: 3,
  kind: 'boq',
  engagementId: 'e-1',
  status: 'draft',
  discountPct: '0',
  taxRate: '0',
  supervisionPct: '0',
  sections: [
    {
      id: 's-1',
      titleAr: null,
      titleEn: 'Ceilings',
      sortOrder: 0,
      sectionSubtotal: '1000',
      lines: [
        {
          id: 'l-1',
          descriptionAr: null,
          descriptionEn: 'Gypsum',
          costItemId: null,
          qty: '10',
          unit: 'sqm',
          unitPrice: '100',
          discountPct: '0',
          lineTotal: '1000',
          sortOrder: 0,
        },
      ],
    },
  ],
} as unknown as ProposalDetail;

function renderBuilder(locale: TestLocale) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  return renderWithIntl(
    <ProposalBuilder
      detail={DETAIL}
      boqMode={{ engagementId: 'e-1', clientCanOpenNow: false, canSend: true }}
      canSend={false}
      seeMargin={false}
      costItems={[]}
      sectionLibrary={[]}
    />,
    { locale },
  );
}

const input = (cell: string) =>
  document.querySelector<HTMLInputElement>(`[data-draft-line="0-0"] [data-draft-input="${cell}"]`)!;
const under = (control: HTMLElement) => {
  const id = control.getAttribute('aria-describedby')?.split(' ').find((part) => part.endsWith('-error'));
  return id ? document.getElementById(id)?.textContent : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  boqActions.sendProposalAsBoq.mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

describe.each<TestLocale>(['en', 'ar-EG'])('builder cell refusals (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  it('an autosave refused for the quantity marks that cell and leaves the caret where it is (AC 30b)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    proposalActions.autosaveProposalDraft.mockResolvedValue(
      fieldsFailed({ 'lines.0.0.qty': { code: 'amount_too_large' } }),
    );
    renderBuilder(locale);
    fireEvent.change(input('qty'), { target: { value: '99999999999' } });
    input('description').focus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(proposalActions.autosaveProposalDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(input('qty').getAttribute('aria-invalid')).toBe('true'));
    expect(under(input('qty'))).toBe(at('errors.amount_too_large'));
    expect(document.activeElement).toBe(input('description'));
    expect(screen.getByRole('alert').textContent).toContain(at('errors.check_fields'));

    fireEvent.change(input('qty'), { target: { value: '12' } });
    expect(input('qty').getAttribute('aria-invalid')).toBeNull();
  });

  it('Send refused for a section name and a price marks both and puts the caret in the first', async () => {
    proposalActions.saveProposalDraft.mockResolvedValue(
      fieldsFailed({
        'sections.0.name': { code: 'name_required' },
        'lines.0.0.unitPrice': { code: 'not_a_number' },
      }),
    );
    renderBuilder(locale);
    fireEvent.change(input('qty'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: at('proposals.boqMode.send') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: at('proposals.boqMode.confirm') }));
    await waitFor(() => expect(input('unitPrice').getAttribute('aria-invalid')).toBe('true'));
    expect(under(input('unitPrice'))).toBe(at('errors.field.not_a_number'));
    const sectionTitle = document.querySelector<HTMLElement>('[data-draft-section="0"] input[aria-invalid="true"]')!;
    expect(under(sectionTitle)).toBe(at('errors.name_required'));
    expect(document.activeElement).toBe(sectionTitle);
    expect(boqActions.sendProposalAsBoq).not.toHaveBeenCalled();
  });

  it('Send with a blank line marks every unfinished cell, not only the first', async () => {
    renderBuilder(locale);
    fireEvent.click(screen.getByRole('button', { name: at('proposals.builder.addLine') }));
    fireEvent.change(input('qty'), { target: { value: '1,5' } });
    fireEvent.click(screen.getByRole('button', { name: at('proposals.boqMode.send') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: at('proposals.boqMode.confirm') }));
    const blank = await waitFor(() => {
      const control = document.querySelector<HTMLElement>('[data-draft-line="0-1"] [data-draft-input="description"]')!;
      expect(control.getAttribute('aria-invalid')).toBe('true');
      return control;
    });
    expect(under(blank)).toBe(at('errors.description_required'));
    expect(under(input('qty'))).toBe(at('errors.field.not_a_number'));
    expect(proposalActions.saveProposalDraft).not.toHaveBeenCalled();
  });
});
