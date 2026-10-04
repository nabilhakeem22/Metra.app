import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { ProposalDraftState } from './proposal-payload';
import { useSendAsBoq } from './use-send-as-boq';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/en/proposals/p-1',
}));

// Both are server actions: replaced, so no server-only stack is loaded.
const actions = vi.hoisted(() => ({ sendProposalAsBoq: vi.fn() }));
vi.mock('@/lib/boq-proposals/actions', () => actions);
const persist = vi.hoisted(() => ({ persistDraft: vi.fn() }));
vi.mock('./persist-draft', () => persist);

const toasts = vi.hoisted(() => [] as Array<{ title?: string; variant?: string }>);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { title?: string; variant?: string }) => {
    toasts.push(raised);
  },
}));

const en = (path: string) => messageAt('en', path);

const draft: ProposalDraftState = {
  id: 'p-1',
  discountPct: '0',
  taxRate: '0',
  supervisionPct: '0',
  seeMargin: true,
  sections: [
    {
      titleEn: 'Ceilings',
      titleAr: '',
      lines: [
        {
          id: null,
          costItemId: null,
          descriptionEn: 'Gypsum',
          descriptionAr: '',
          qty: '10',
          unit: 'sqm',
          unitCost: '60',
          unitPrice: '100',
          discountPct: '0',
        },
      ],
    },
    { titleEn: 'Empty', titleAr: '', lines: [] },
  ],
};

const confirm = vi.fn();

function Harness() {
  const { send, pending } = useSendAsBoq({
    proposalId: 'p-1',
    engagementId: 'e-1',
    clientCanOpenNow: false,
    draftState: () => draft,
    totalBeforeVat: () => '1000.0000',
    confirm,
  });
  return (
    <button type="button" data-pending={String(pending)} onClick={() => void send()}>
      send
    </button>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  toasts.length = 0;
  confirm.mockResolvedValue(true);
});

describe('useSendAsBoq', () => {
  it('states the sendable lines, sections, total and the locked gate in ONE confirm', async () => {
    persist.persistDraft.mockResolvedValue({ ok: true });
    actions.sendProposalAsBoq.mockResolvedValue({ ok: true, data: { documentNumber: 'BQ-2026-0014' } });
    renderWithIntl(<Harness />, { locale: 'en' });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const { description, title } = confirm.mock.calls[0][0];
    expect(title).toBe(en('proposals.boqMode.confirmTitle'));
    expect(description).toContain('1 line in 1 section');
    expect(description).toContain('1,000.00');
    expect(description).toContain(en('proposals.boqMode.gateLocked'));
  });

  it('a cancelled confirm saves and sends nothing', async () => {
    confirm.mockResolvedValue(false);
    renderWithIntl(<Harness />, { locale: 'en' });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(persist.persistDraft).not.toHaveBeenCalled();
    expect(actions.sendProposalAsBoq).not.toHaveBeenCalled();
  });

  it('a refused save stops before the send and toasts the coded error', async () => {
    persist.persistDraft.mockResolvedValue({ ok: false, error: 'too_many_lines' });
    renderWithIntl(<Harness />, { locale: 'en' });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toasts.at(-1)?.title).toBe(en('errors.too_many_lines')));
    expect(actions.sendProposalAsBoq).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a successful send toasts the BQ number and returns to the delivery', async () => {
    persist.persistDraft.mockResolvedValue({ ok: true });
    actions.sendProposalAsBoq.mockResolvedValue({ ok: true, data: { documentNumber: 'BQ-2026-0014' } });
    renderWithIntl(<Harness />, { locale: 'en' });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/engagements/e-1'));
    expect(actions.sendProposalAsBoq).toHaveBeenCalledWith('p-1');
    expect(toasts.at(-1)?.title).toBe('BQ-2026-0014 sent to the client');
  });

  it('a THROWN action toasts generic and clears the spinner', async () => {
    persist.persistDraft.mockResolvedValue({ ok: true });
    actions.sendProposalAsBoq.mockRejectedValue(new Error('network died'));
    renderWithIntl(<Harness />, { locale: 'en' });
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => expect(toasts.at(-1)?.title).toBe(en('errors.generic')));
    await waitFor(() => expect(button.getAttribute('data-pending')).toBe('false'));
    expect(router.push).not.toHaveBeenCalled();
  });
});
