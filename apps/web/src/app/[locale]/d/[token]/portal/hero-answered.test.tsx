import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerDialog, landRefresh, renderCommandCard, type CommandCardProps } from '@/test/portal-command-card';
import { messageAt, type TestLocale } from '@/test/render-with-intl';

// F1 / F10: once the client has answered a review, the hero never tells them the
// stage is still waiting for them: not right after the act (with the refresh
// landed) and not after a reload. A choice is named once.

const actions = vi.hoisted(() => ({
  chooseDeliveryConcept: vi.fn(),
  respondToDeliveryConcept: vi.fn(),
  respondToDeliveryDesign: vi.fn(),
  approveDesignWithBudget: vi.fn(),
  acknowledgeDeliveryHandover: vi.fn(),
}));
vi.mock('../review-actions', () => actions);
vi.mock('../actions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const OPTION_B = { id: '22222222-2222-4222-8222-222222222222', position: 2 as const, letter: 'B' as const };
const OPTION_A = { id: '11111111-1111-4111-8111-111111111111', position: 1 as const, letter: 'A' as const };
const CALM = { kind: 'inProgress', showRomAck: false } as const;
const isolated = (letter: string) => `⁨${letter}⁩`;

/** What the server answers after the act (or on a reload): calm, the verbs gone. */
function answeredAt(stageKey: 'conceptReview' | 'finalApproval' | 'handover', extra: Partial<CommandCardProps> = {}): CommandCardProps {
  return { hero: CALM, clientActions: [], stageKey, ...extra };
}

/** No text on the page may say the stage is still waiting for the client. */
function expectNoStaleAsk(locale: TestLocale) {
  for (const key of ['delivery.stage.finalApproval.label', 'delivery.stage.conceptReview.label', 'delivery.hero.reassurance']) {
    expect(screen.queryByText(messageAt(locale, key)), key).toBeNull();
  }
}

beforeEach(() => {
  actions.respondToDeliveryDesign.mockReset().mockImplementation(async (_token: string, verb: string) => ({
    kind: verb === 'approve_design' ? 'approved' : 'changes_requested',
    studioNotified: true,
  }));
  actions.respondToDeliveryConcept.mockReset();
  actions.chooseDeliveryConcept.mockReset();
});

describe('after the act, with the refresh landed', () => {
  it.each([
    ['design approve', 'design', 'approve'],
    ['design request changes', 'design', 'changes'],
  ] as const)('%s', async (_label, group, button) => {
    renderCommandCard(
      { hero: { kind: 'action', group, showRomAck: false }, clientActions: ['approve_design', 'request_design_changes'], stageKey: 'finalApproval' },
      { afterRefresh: answeredAt('finalApproval') },
    );
    if (button === 'changes') fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Darker wood' } });
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', `delivery.hero.design.${button}`) }));
    if (button === 'approve') await answerDialog('en', 'confirm');
    await act(async () => {});
    landRefresh();
    expect(screen.getByText(messageAt('en', `delivery.hero.design.${button === 'approve' ? 'approvedTitle' : 'changesTitle'}`))).toBeTruthy();
    expectNoStaleAsk('en');
  });

  it('choose option B: the confirmation names it once', async () => {
    actions.chooseDeliveryConcept.mockResolvedValue({ kind: 'chosen', letter: 'B', studioNotified: true });
    renderCommandCard(
      { hero: { kind: 'action', group: 'concept', showRomAck: false }, clientActions: ['approve_concept'], conceptOptions: [OPTION_A, OPTION_B] },
      { afterRefresh: answeredAt('conceptReview', { conceptDecision: 'chosen', conceptChoice: { id: OPTION_B.id, letter: 'B' } }) },
    );
    const card = document.querySelector('[data-concept-option="B"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: messageAt('en', 'delivery.conceptPicker.choose') }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = messageAt('en', 'delivery.conceptPicker.confirm').replace('{letter}', isolated('B'));
    fireEvent.click(within(dialog).getByRole('button', { name: confirm }));
    await act(async () => {});
    landRefresh();
    const chosen = messageAt('en', 'delivery.conceptPicker.chosen').replace('{letter}', isolated('B'));
    expect(screen.getAllByText(chosen)).toHaveLength(1);
    expectNoStaleAsk('en');
  });
});

describe('after a reload: the calm hero says what the client answered', () => {
  it.each([
    ['design (approve or changes)', answeredAt('finalApproval'), 'delivery.hero.answered.responded'],
    ['concept approved, 0 or 1 option', answeredAt('conceptReview', { conceptDecision: 'approved' }), 'delivery.hero.answered.conceptApproved'],
    ['concept changes', answeredAt('conceptReview', { conceptDecision: 'changes_requested' }), 'delivery.hero.answered.conceptChanges'],
  ] as const)('%s', (_label, props, headlineKey) => {
    for (const locale of ['en', 'ar-EG'] as const) {
      const view = renderCommandCard(props, { locale });
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(messageAt(locale, headlineKey));
      expect(screen.getByText(messageAt(locale, 'delivery.hero.answered.body'))).toBeTruthy();
      expectNoStaleAsk(locale);
      view.unmount();
    }
  });

  it('a saved choice of B: "You chose option B." once, as the headline', () => {
    renderCommandCard(answeredAt('conceptReview', { conceptDecision: 'chosen', conceptChoice: { id: OPTION_B.id, letter: 'B' } }), { locale: 'ar-EG' });
    const chosen = messageAt('ar-EG', 'delivery.conceptPicker.chosen').replace('{letter}', isolated('B'));
    expect(screen.getAllByText(chosen)).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(chosen);
    expectNoStaleAsk('ar-EG');
  });

  it('while a verb is still offered (one slot held by a retraction) it is not "answered"', () => {
    renderCommandCard({ hero: { kind: 'action', group: 'design', showRomAck: false }, clientActions: ['approve_design'], stageKey: 'finalApproval' });
    expect(screen.queryByText(messageAt('en', 'delivery.hero.answered.responded'))).toBeNull();
  });
});

describe('F2: the handover is "received" until it is really closed', () => {
  it('after a reload at the handover stage: received, the studio closes it shortly', () => {
    for (const locale of ['en', 'ar-EG'] as const) {
      const view = renderCommandCard(answeredAt('handover'), { locale });
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(messageAt(locale, 'delivery.hero.answered.handoverReceived'));
      expect(screen.getByText(messageAt(locale, 'delivery.hero.answered.handoverBody'))).toBeTruthy();
      expect(screen.queryByText(messageAt(locale, 'delivery.stage.handover.label'))).toBeNull();
      view.unmount();
    }
  });

  it('no handover copy before the close claims the project is complete', () => {
    for (const key of ['confirmBody', 'acknowledgedBody', 'acknowledgedBodyNotified']) {
      expect(messageAt('en', `delivery.hero.handoff.${key}`)).not.toMatch(/complete/i);
      expect(messageAt('ar-EG', `delivery.hero.handoff.${key}`)).not.toMatch(/اكتمل|يكتمل/);
    }
  });
});
