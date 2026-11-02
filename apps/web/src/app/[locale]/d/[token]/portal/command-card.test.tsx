import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { messageAt, type TestLocale } from '@/test/render-with-intl';
import { landRefresh, renderCommandCard, type CommandCardProps } from '@/test/portal-command-card';

// The design tab's card on the shared step card (H8, AC1 to AC8): its colour says
// whose move it is, its rail where the job stands, and when the move is the
// client's only because a fee is due it says which one, instead of "nothing to do".

const actions = vi.hoisted(() => ({ chooseDeliveryConcept: vi.fn(), respondToDeliveryConcept: vi.fn(), respondToDeliveryDesign: vi.fn(), approveDesignWithBudget: vi.fn(), acknowledgeDeliveryHandover: vi.fn() }));
vi.mock('../review-actions', () => actions);
vi.mock('../actions', () => ({}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const LOCALES: TestLocale[] = ['en', 'ar-EG'];
const CALM = { kind: 'inProgress', showRomAck: false } as const;

function instalment(kind: string, status: PublicDelivery['paymentSchedule'][number]['status']): PublicDelivery['paymentSchedule'][number] {
  return { milestone_kind: kind, basis: 'amount', amount_due: '1000.0000', amount_cleared: status === 'paid' ? '1000.0000' : '0.0000', status };
}

function feeFacts(kind: string, fee: 'due' | 'claimed' | 'paid'): Pick<CommandCardProps, 'paymentSchedule' | 'paymentClaim'> {
  return {
    paymentSchedule: [instalment(kind, fee === 'paid' ? 'paid' : 'due')],
    paymentClaim: {
      claimableMilestones: fee === 'paid' ? [] : [{ milestoneKind: kind, amountRemaining: '1000.0000', hasPendingClaim: fee === 'claimed', claimedAt: null }],
    },
  };
}

const card = (container: HTMLElement) => container.querySelector('section.glass') as HTMLElement;
const stripe = (container: HTMLElement) => card(container).querySelector('span[aria-hidden]') as HTMLElement;
const whoseMove = (container: HTMLElement) => container.querySelector('[data-whose-move]')!.getAttribute('data-whose-move');
const current = (container: HTMLElement) => [...container.querySelectorAll('[aria-current="step"]')].map((step) => step.textContent);

beforeEach(() => router.refresh.mockReset());

describe('the card', () => {
  it.each(LOCALES)('is the shared step card with six steps in its band and no gate (%s)', (locale) => {
    const { container } = renderCommandCard({ hero: { kind: 'action', group: 'concept', showRomAck: false }, clientActions: ['approve_concept'] }, { locale });
    expect(card(container).querySelectorAll('[data-rail-step]')).toHaveLength(6);
    expect(card(container).querySelectorAll('ol > li')).toHaveLength(6);
    expect(screen.queryByText(locale === 'en' ? 'Your journey' : 'رحلتك')).toBeNull();
  });

  it('wears the brand stripe when the client holds the move', () => {
    const { container } = renderCommandCard({ hero: { kind: 'action', group: 'concept', showRomAck: false }, clientActions: ['approve_concept'] });
    expect(stripe(container).className).toContain('bg-brand');
    expect(whoseMove(container)).toBe('client');
  });

  it('wears the rule colour while the studio holds it', () => {
    const { container } = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'measuring' });
    expect(stripe(container).className).toContain('bg-[color:var(--rule)]');
    expect(whoseMove(container)).toBe('studio');
  });

  it('wears the success stripe once the design is delivered, with no fee line even if the balance is still due', () => {
    const { container } = renderCommandCard({ hero: { kind: 'delivered', showRomAck: false }, clientActions: [], stageKey: 'delivered', ...feeFacts('balance', 'due') });
    expect(stripe(container).className).toContain('bg-[color:var(--success)]');
    expect(whoseMove(container)).toBe('none');
    expect(current(container)).toEqual([]);
    expect(container.querySelector('[data-fee-wait]')).toBeNull();
    expect(container.querySelector('[data-rail-current-name]')).toBeNull();
    expect(screen.queryByText(messageAt('en', 'delivery.whatsNext.eyebrow'), { exact: false })).toBeNull();
  });

  it('mutes everything once abandoned, in the calm hero\'s closed words, with no fee line and no next line', () => {
    const { container } = renderCommandCard({ hero: { kind: 'closed', showRomAck: false }, clientActions: [], stageKey: 'closed' });
    expect(stripe(container).className).toContain('bg-[color:var(--rule)]');
    expect(container.querySelectorAll('[data-rail-step] .bg-\\[color\\:var\\(--rule\\)\\]')).toHaveLength(6);
    expect(current(container)).toEqual([]);
    expect(screen.getByText(messageAt('en', 'delivery.stage.closed.note'))).toBeTruthy();
    expect(container.querySelector('[data-fee-wait]')).toBeNull();
    expect(screen.queryByText(messageAt('en', 'delivery.whatsNext.eyebrow'), { exact: false })).toBeNull();
  });
});

describe('the fee wait', () => {
  it.each(LOCALES)('at the proposal with the deposit due it names the instalment and points at the payments (%s)', (locale) => {
    const { container } = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'proposalReady', ...feeFacts('deposit', 'due') }, { locale });
    const line = container.querySelector('[data-fee-wait]');
    expect(line?.textContent).toBe(messageAt(locale, 'delivery.hero.feeWait').replace('{instalment}', messageAt(locale, 'delivery.payments.kind.deposit')));
    expect(screen.getByRole('link', { name: messageAt(locale, 'delivery.home.act.howToPay') }).getAttribute('href')).toBe('#payments');
    expect(screen.getByText(messageAt(locale, 'delivery.stage.proposalReady.note'))).toBeTruthy();
    expect(screen.queryByText(messageAt(locale, 'delivery.hero.reassurance'))).toBeNull();
    expect(stripe(container).className).toContain('bg-brand');
  });

  it.each(['claimed', 'paid'] as const)('with the deposit %s there is no line, the reassurance is back and the stripe is not brand', (fee) => {
    const { container } = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'proposalReady', ...feeFacts('deposit', fee) });
    expect(container.querySelector('[data-fee-wait]')).toBeNull();
    expect(screen.queryByRole('link', { name: messageAt('en', 'delivery.home.act.howToPay') })).toBeNull();
    expect(screen.getByText(messageAt('en', 'delivery.hero.reassurance'))).toBeTruthy();
    expect(stripe(container).className).not.toContain('bg-brand');
  });

  it('an open act outranks the fee: no line beside the action hero at the final approval', () => {
    const { container } = renderCommandCard({
      hero: { kind: 'action', group: 'design', showRomAck: false },
      clientActions: ['approve_design'],
      stageKey: 'finalApproval',
      ...feeFacts('gate_b', 'due'),
    });
    expect(container.querySelector('[data-fee-wait]')).toBeNull();
    expect(screen.getByRole('button', { name: messageAt('en', 'delivery.hero.design.approve') })).toBeTruthy();
    expect(stripe(container).className).toContain('bg-brand');
  });
});

describe('the confirmation across the refresh', () => {
  it('stays the same DOM node while the rail and the stripe move on', async () => {
    const A = { id: '11111111-1111-4111-8111-111111111111', position: 1 as const, letter: 'A' as const };
    const B = { id: '22222222-2222-4222-8222-222222222222', position: 2 as const, letter: 'B' as const };
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'chosen', letter: 'B', studioNotified: true });
    const { container } = renderCommandCard(
      { hero: { kind: 'action', group: 'concept', showRomAck: false }, clientActions: ['approve_concept'], conceptOptions: [A, B] },
      { afterRefresh: { hero: CALM, clientActions: [], stageKey: 'visuals' } },
    );
    expect(stripe(container).className).toContain('bg-brand');
    expect(current(container)).toEqual([messageAt('en', 'delivery.journey.concept')]);
    const shell = card(container);
    const option = document.querySelector('[data-concept-option="B"]') as HTMLElement;
    fireEvent.click(within(option).getByRole('button', { name: messageAt('en', 'delivery.conceptPicker.choose') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: messageAt('en', 'delivery.conceptPicker.confirm').replace('{letter}', '\u2068B\u2069') }));
    await act(async () => {});
    expect(router.refresh).toHaveBeenCalledTimes(1);
    const chosen = messageAt('en', 'delivery.conceptPicker.chosen').replace('{letter}', '\u2068B\u2069');
    const confirmed = screen.getByText(chosen);
    landRefresh();
    expect(screen.getByText(chosen)).toBe(confirmed);
    expect(card(container)).toBe(shell);
    expect(current(container)).toEqual([messageAt('en', 'delivery.journey.design')]);
    expect(stripe(container).className).toContain('bg-[color:var(--rule)]');
  });
});
