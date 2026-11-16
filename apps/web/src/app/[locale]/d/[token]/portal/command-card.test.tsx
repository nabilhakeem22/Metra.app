import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { messageAt, type TestLocale } from '@/test/render-with-intl';
import { answerDialog, landRefresh, renderCommandCard, type CommandCardProps } from '@/test/portal-command-card';

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
const DETAILS = { instapay: 'studio@instapay', bankName: null, bankAccountHolder: null, bankAccountNumber: null, bankIban: null };
const AT = '2026-10-01T09:00:00.000Z';

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
const upNext = (container: HTMLElement) => container.querySelector('[data-whose-move] > p svg.lucide-arrow-right');
const current = (container: HTMLElement) => [...container.querySelectorAll('[aria-current="step"]')].map((step) => step.textContent);

beforeEach(() => {
  router.refresh.mockReset();
  for (const action of Object.values(actions)) action.mockReset();
});

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
    const { container } = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'proposalReady', paymentDetails: DETAILS, ...feeFacts('deposit', 'due') }, { locale });
    const line = container.querySelector('[data-fee-wait]');
    expect(line?.textContent).toBe(messageAt(locale, 'delivery.hero.feeWait').replace('{instalment}', messageAt(locale, 'delivery.payments.kind.deposit')));
    expect(screen.getByRole('link', { name: messageAt(locale, 'delivery.home.act.howToPay') }).getAttribute('href')).toBe('#payments');
    expect(screen.getByText(messageAt(locale, 'delivery.stage.proposalReady.note'))).toBeTruthy();
    expect(screen.queryByText(messageAt(locale, 'delivery.hero.reassurance'))).toBeNull();
    expect(screen.queryByText(messageAt(locale, 'delivery.hero.feeWaitAskDesigner'))).toBeNull();
    expect(stripe(container).className).toContain('bg-brand');
  });

  it.each(LOCALES)('with no payment details it promises no way to pay: ask the designer, and only see the payment (F7, %s)', (locale) => {
    const { container } = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'proposalReady', ...feeFacts('deposit', 'due') }, { locale });
    expect(container.querySelector('[data-fee-wait]')).not.toBeNull();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.feeWaitAskDesigner'))).toBeTruthy();
    expect(screen.getByRole('link', { name: messageAt(locale, 'delivery.home.act.seePayment') }).getAttribute('href')).toBe('#payments');
    expect(screen.queryByRole('link', { name: messageAt(locale, 'delivery.home.act.howToPay') })).toBeNull();
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

describe('a change request on file waits on the studio, not on the fee (F1)', () => {
  it.each(LOCALES)('at the concept review, with Gate A due (%s)', (locale) => {
    const { container } = renderCommandCard(
      { hero: CALM, clientActions: [], stageKey: 'conceptReview', conceptDecision: 'changes_requested', paymentDetails: DETAILS, ...feeFacts('gate_a', 'due') },
      { locale },
    );
    expect(container.querySelector('[data-fee-wait]')).toBeNull();
    expect(screen.queryByRole('link', { name: messageAt(locale, 'delivery.home.act.howToPay') })).toBeNull();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.answered.conceptChanges'))).toBeTruthy();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.answered.body'))).toBeTruthy();
    expect(stripe(container).className).toContain('bg-[color:var(--rule)]');
    expect(whoseMove(container)).toBe('studio');
    expect(upNext(container), 'N3: no next step while the change request is on file').toBeNull();
  });

  it.each(LOCALES)('at the final approval, with Gate B due (%s)', (locale) => {
    const { container } = renderCommandCard(
      { hero: CALM, clientActions: [], stageKey: 'finalApproval', designDecision: { kind: 'changes_requested', at: AT }, paymentDetails: DETAILS, ...feeFacts('gate_b', 'due') },
      { locale },
    );
    expect(container.querySelector('[data-fee-wait]')).toBeNull();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.answered.responded'))).toBeTruthy();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.answered.body'))).toBeTruthy();
    expect(stripe(container).className).toContain('bg-[color:var(--rule)]');
    expect(whoseMove(container)).toBe('studio');
    expect(upNext(container), 'N3: no next step while the change request is on file').toBeNull();
  });

  it.each(LOCALES)('an approved or chosen answer keeps its next step (N3, %s)', (locale) => {
    const OPTION_A = { id: '11111111-1111-4111-8111-111111111111', letter: 'A' as const };
    const design = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'finalApproval', designDecision: { kind: 'approved', at: AT }, ...feeFacts('gate_b', 'due') }, { locale });
    expect(upNext(design.container)).not.toBeNull();
    design.unmount();
    const approved = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'conceptReview', conceptDecision: 'approved', ...feeFacts('gate_a', 'due') }, { locale });
    expect(upNext(approved.container)).not.toBeNull();
    approved.unmount();
    const chosen = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'conceptReview', conceptDecision: 'chosen', conceptChoice: OPTION_A, ...feeFacts('gate_a', 'due') }, { locale });
    expect(upNext(chosen.container)).not.toBeNull();
  });
});

describe('the body never contradicts the fee line (F5)', () => {
  const body = (locale: TestLocale) => screen.queryByText(messageAt(locale, 'delivery.hero.answered.body'));

  it.each(LOCALES)('an answered calm hero with a fee awaited says what was answered, and no body (%s)', (locale) => {
    const OPTION_A = { id: '11111111-1111-4111-8111-111111111111', letter: 'A' as const };
    const chosen = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'conceptReview', conceptDecision: 'chosen', conceptChoice: OPTION_A, ...feeFacts('gate_a', 'due') }, { locale });
    expect(chosen.container.querySelector('[data-fee-wait]')).not.toBeNull();
    expect(chosen.container.textContent).toContain(messageAt(locale, 'delivery.conceptPicker.chosen').replace('{letter}', '\u2068A\u2069'));
    expect(body(locale)).toBeNull();
    chosen.unmount();

    const design = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'finalApproval', designDecision: { kind: 'approved', at: AT }, ...feeFacts('gate_b', 'due') }, { locale });
    expect(design.container.querySelector('[data-fee-wait]')).not.toBeNull();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.answered.responded'))).toBeTruthy();
    expect(body(locale)).toBeNull();
    expect(design.container.querySelector('section.rounded-panel')?.querySelectorAll('p')).toHaveLength(0);
  });

  it.each(LOCALES)('an answered calm hero with no fee awaited keeps the body (%s)', (locale) => {
    renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'finalApproval', designDecision: { kind: 'approved', at: AT }, ...feeFacts('gate_b', 'paid') }, { locale });
    expect(body(locale)).toBeTruthy();
  });

  it.each(LOCALES)('an unanswered calm hero keeps the stage note, at the next steps too (%s)', (locale) => {
    const { container } = renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'nextSteps', ...feeFacts('balance', 'due') }, { locale });
    expect(container.querySelector('[data-fee-wait]')).not.toBeNull();
    expect(screen.getByText(messageAt(locale, 'delivery.stage.nextSteps.label'))).toBeTruthy();
    expect(screen.getByText(messageAt(locale, 'delivery.stage.nextSteps.note'))).toBeTruthy();
  });
});

describe('an approval whose next step waits on the fee (F5)', () => {
  const DESIGN_OPEN = { hero: { kind: 'action', group: 'design', showRomAck: false }, clientActions: ['approve_design', 'request_design_changes'], stageKey: 'finalApproval' } as const;
  const DESIGN_ANSWERED = { hero: CALM, clientActions: [], stageKey: 'finalApproval', designDecision: { kind: 'approved', at: AT } } as const;

  async function approve(locale: TestLocale) {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'delivery.hero.design.approve') }));
    await answerDialog(locale, 'confirm');
    await act(async () => {});
  }

  it.each(LOCALES)('says only that it is recorded and notified, from the tap on, in the same node across the refresh (%s)', async (locale) => {
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'approved', studioNotified: true });
    const facts = feeFacts('gate_b', 'due');
    const { container } = renderCommandCard({ ...DESIGN_OPEN, clientActions: [...DESIGN_OPEN.clientActions], ...facts }, { locale, afterRefresh: { ...DESIGN_ANSWERED, clientActions: [], ...facts } });
    await approve(locale);
    const said = screen.getByText(messageAt(locale, 'delivery.hero.approvedFeeWaitsNotified'));
    expect(screen.getByText(messageAt(locale, 'delivery.hero.design.approvedTitle'))).toBeTruthy();
    expect(screen.queryByText(messageAt(locale, 'delivery.hero.design.approvedBodyNotified'))).toBeNull();
    landRefresh();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.approvedFeeWaitsNotified'))).toBe(said);
    expect(container.querySelector('[data-fee-wait]')).not.toBeNull();
    expect(screen.queryByText(messageAt(locale, 'delivery.hero.design.approvedBodyNotified'))).toBeNull();
  });

  it.each(LOCALES)('does not say the designer was told when no notification was written (%s)', async (locale) => {
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'approved', studioNotified: false });
    renderCommandCard({ ...DESIGN_OPEN, clientActions: [...DESIGN_OPEN.clientActions], ...feeFacts('gate_b', 'due') }, { locale });
    await approve(locale);
    expect(screen.getByText(messageAt(locale, 'delivery.hero.approvedFeeWaits'))).toBeTruthy();
    expect(screen.queryByText(messageAt(locale, 'delivery.hero.approvedFeeWaitsNotified'))).toBeNull();
    expect(screen.queryByText(messageAt(locale, 'delivery.hero.design.approvedBody'))).toBeNull();
  });

  it.each(LOCALES)('keeps the budget line of a one-tap approve and budget (%s)', async (locale) => {
    actions.approveDesignWithBudget.mockResolvedValue({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    renderCommandCard(
      {
        ...DESIGN_OPEN,
        hero: { kind: 'action', group: 'design', showRomAck: true },
        clientActions: [...DESIGN_OPEN.clientActions, 'acknowledge_rom'],
        rom: { low: '900000.0000', high: '1200000.0000', issuedAt: '2026-09-01T09:00:00.123456+00:00' },
        ...feeFacts('gate_b', 'due'),
      },
      { locale },
    );
    await approve(locale);
    expect(screen.getByText(messageAt(locale, 'delivery.hero.approvedFeeWaitsNotified'))).toBeTruthy();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.design.budgetAcknowledged'))).toBeTruthy();
  });

  it('with the gate paid, or claimed, it still says what comes next', async () => {
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'approved', studioNotified: true });
    for (const fee of ['paid', 'claimed'] as const) {
      const { unmount } = renderCommandCard({ ...DESIGN_OPEN, clientActions: [...DESIGN_OPEN.clientActions], ...feeFacts('gate_b', fee) });
      await approve('en');
      expect(screen.getByText(messageAt('en', 'delivery.hero.design.approvedBodyNotified'))).toBeTruthy();
      expect(screen.queryByText(messageAt('en', 'delivery.hero.approvedFeeWaitsNotified'))).toBeNull();
      unmount();
    }
  });

  it('a change request, with the gate due, keeps its own words and loses the fee line once on file', async () => {
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'changes_requested', studioNotified: true });
    const facts = feeFacts('gate_b', 'due');
    const { container } = renderCommandCard(
      { ...DESIGN_OPEN, clientActions: [...DESIGN_OPEN.clientActions], ...facts },
      { afterRefresh: { hero: CALM, clientActions: [], stageKey: 'finalApproval', designDecision: { kind: 'changes_requested', at: AT }, ...facts } },
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'More light' } });
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'delivery.hero.design.changes') }));
    await act(async () => {});
    const said = screen.getByText(messageAt('en', 'delivery.hero.design.changesBodyNotified'));
    landRefresh();
    expect(screen.getByText(messageAt('en', 'delivery.hero.design.changesBodyNotified'))).toBe(said);
    expect(container.querySelector('[data-fee-wait]')).toBeNull();
    expect(stripe(container).className).toContain('bg-[color:var(--rule)]');
  });
});

describe('a confirmed answer on an offline phone (N2)', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(LOCALES)('keeps the confirmation, and refreshes once when the network returns (%s)', async (locale) => {
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'approved', studioNotified: true });
    const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderCommandCard({ hero: { kind: 'action', group: 'design', showRomAck: false }, clientActions: ['approve_design', 'request_design_changes'], stageKey: 'finalApproval' }, { locale });
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'delivery.hero.design.approve') }));
    await answerDialog(locale, 'confirm');
    await act(async () => {});
    const said = screen.getByText(messageAt(locale, 'delivery.hero.design.approvedTitle'));
    expect(router.refresh).not.toHaveBeenCalled();
    offline.mockRestore();
    window.dispatchEvent(new Event('online'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(messageAt(locale, 'delivery.hero.design.approvedTitle'))).toBe(said);
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
