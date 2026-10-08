// R3: while Send as BOQ is in flight the WHOLE builder is disabled: an edit typed
// during the send would be saved after the snapshot the BOQ was cut from.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ProposalBuilder } from './builder-client';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));
const nextRouter = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => nextRouter,
}));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/en/proposals/p-1',
}));

// Every server action the builder reaches: replaced, so no server stack loads.
const boqActions = vi.hoisted(() => ({ sendProposalAsBoq: vi.fn() }));
vi.mock('@/lib/boq-proposals/actions', () => boqActions);
const proposalActions = vi.hoisted(() => ({
  saveProposalDraft: vi.fn(),
  autosaveProposalDraft: vi.fn(),
}));
vi.mock('@/lib/proposals/actions', () => ({
  ...proposalActions,
  deleteDraftProposal: vi.fn(),
  sendProposal: vi.fn(),
  getProposalPreviewHtml: vi.fn(),
}));
vi.mock('@/lib/sections/actions', () => ({ addSection: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const en = (path: string) => messageAt('en', path);

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

function renderBoqBuilder() {
  return renderWithIntl(
    <ProposalBuilder
      detail={DETAIL}
      boqMode={{ engagementId: 'e-1', clientCanOpenNow: false, canSend: true }}
      canSend={false}
      seeMargin={false}
      costItems={[]}
      sectionLibrary={[]}
    />,
    { locale: 'en' },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const receipt = { ok: true, data: { revision: '1789000000000001', sections: [{ id: 's-1', lineIds: ['l-1'] }] } };
  proposalActions.saveProposalDraft.mockResolvedValue(receipt);
  proposalActions.autosaveProposalDraft.mockResolvedValue(receipt);
});

describe('the builder while Send as BOQ is in flight (R3)', () => {
  it('disables every editor, Preview, Back and Send until the send settles', async () => {
    let finishSend: (value: unknown) => void = () => {};
    boqActions.sendProposalAsBoq.mockReturnValue(
      new Promise((resolve) => {
        finishSend = resolve;
      }),
    );
    const { container } = renderBoqBuilder();
    const send = screen.getByRole('button', { name: en('proposals.boqMode.send') });
    expect(send.matches(':disabled')).toBe(false);

    fireEvent.click(send);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en('proposals.boqMode.confirm') }));

    await waitFor(() => expect(boqActions.sendProposalAsBoq).toHaveBeenCalledWith('p-1'));
    // Every editor sits in ONE disabled <fieldset> (no <legend>, whose content a
    // browser would leave enabled). jsdom does not apply fieldset-disabling to
    // :disabled, so the containment is what is asserted; the browser enforces it.
    const fieldset = container.querySelector('fieldset');
    expect(fieldset?.disabled).toBe(true);
    expect(fieldset?.querySelector('legend')).toBeNull();
    const editors = container.querySelectorAll('input, select, textarea, button');
    const outside = [...editors].filter((control) => !fieldset?.contains(control));
    expect(outside).toEqual([]);
    expect(fieldset?.querySelectorAll('input').length).toBeGreaterThan(3);
    // And the named controls carry their own disabled state too.
    for (const name of [
      en('proposals.preview.open'),
      en('proposals.boqMode.back'),
      en('proposals.boqMode.send'),
    ]) {
      expect(screen.getByRole('button', { name }).matches(':disabled')).toBe(true);
    }

    finishSend({ ok: true, data: { documentNumber: 'BQ-2026-0014', boqStep: 'not_at_boq' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: en('proposals.preview.open') }).matches(':disabled')).toBe(false),
    );
  });
});

describe('the builder saves itself (B6)', () => {
  it('has no Save button and says where the draft stands', () => {
    renderBoqBuilder();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(en('proposals.builder.autosave.saved'));
  });

  it('Send as BOQ stores the latest edit first, through the refreshing save, then sends', async () => {
    boqActions.sendProposalAsBoq.mockResolvedValue({ ok: true, data: { documentNumber: 'BQ-2026-0014', boqStep: 'not_at_boq' } });
    const { container } = renderBoqBuilder();
    const qty = container.querySelector('input[value="10"]') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '12' } });
    expect(screen.getByRole('status').textContent).toBe(en('proposals.builder.autosave.dirty'));

    fireEvent.click(screen.getByRole('button', { name: en('proposals.boqMode.send') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en('proposals.boqMode.confirm') }));

    await waitFor(() => expect(boqActions.sendProposalAsBoq).toHaveBeenCalledWith('p-1'));
    expect(proposalActions.saveProposalDraft).toHaveBeenCalledTimes(1);
    expect(proposalActions.saveProposalDraft.mock.calls[0][0].sections[0].lines[0].qty).toBe('12');
    expect(proposalActions.saveProposalDraft.mock.invocationCallOrder[0]).toBeLessThan(
      boqActions.sendProposalAsBoq.mock.invocationCallOrder[0],
    );
    expect(proposalActions.autosaveProposalDraft).not.toHaveBeenCalled();
    expect(proposalActions.saveProposalDraft.mock.calls[0][0].revision).toBe('1789000000000000');
  });

  it('F3: Send as BOQ with a blank line just added sends nothing, says why and puts the caret in it', async () => {
    renderBoqBuilder();
    fireEvent.click(screen.getByRole('button', { name: en('proposals.builder.addLine') }));
    expect(screen.getByRole('status').textContent).toBe(en('proposals.builder.autosave.incomplete'));
    fireEvent.click(screen.getByRole('button', { name: en('proposals.boqMode.send') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en('proposals.boqMode.confirm') }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(en('errors.draft_incomplete')),
    );
    expect(boqActions.sendProposalAsBoq).not.toHaveBeenCalled();
    expect(proposalActions.saveProposalDraft).not.toHaveBeenCalled();
    expect((document.activeElement as HTMLElement).getAttribute('data-draft-input')).toBe('description');
  });

  it('F2: leaving through an in-app link with a blank line keeps the studio here and asks, with the reason', async () => {
    renderBoqBuilder();
    fireEvent.click(screen.getByRole('button', { name: en('proposals.builder.addLine') }));
    const away = document.createElement('a');
    away.href = '/en/engagements';
    away.textContent = 'Deliveries';
    document.body.appendChild(away);
    fireEvent.click(away);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(en('errors.draft_incomplete'));
    fireEvent.click(within(dialog).getByRole('button', { name: en('proposals.builder.leave.stay') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(nextRouter.push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(en('errors.draft_incomplete'));
    away.remove();
  });

  it('F2: leaving with a finished edit saves it first, then goes', async () => {
    const { container } = renderBoqBuilder();
    fireEvent.change(container.querySelector('input[value="10"]') as HTMLInputElement, { target: { value: '11' } });
    const away = document.createElement('a');
    away.href = '/en/engagements';
    document.body.appendChild(away);
    fireEvent.click(away);
    await waitFor(() => expect(nextRouter.push).toHaveBeenCalledWith('/en/engagements'));
    expect(proposalActions.saveProposalDraft.mock.calls[0][0].sections[0].lines[0].qty).toBe('11');
    away.remove();
  });
});
