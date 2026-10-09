import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerDialog, renderCommandCard } from '@/test/portal-command-card';
import { messageAt } from '@/test/render-with-intl';

// What the hero says once an act answered: the designer HAS BEEN NOTIFIED only
// when the portal action says a notification row was written for this act, and
// a concept verb confirms the decision SAVED on file (a repeat shows that one,
// never the verb just tapped).

const actions = vi.hoisted(() => ({
  recordDeliveryAction: vi.fn(),
  chooseDeliveryConcept: vi.fn(),
  respondToDeliveryConcept: vi.fn(),
}));
vi.mock('../actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const en = (path: string) => messageAt('en', path);
const GROUP_VERBS = {
  concept: ['approve_concept', 'request_concept_changes'],
  design: ['approve_design', 'request_design_changes'],
  handoff: ['acknowledge_handoff'],
} as const;

function renderHero(group: keyof typeof GROUP_VERBS, locale: 'en' | 'ar-EG' = 'en') {
  return renderCommandCard(
    { hero: { kind: 'action', group, showRomAck: false }, clientActions: [...GROUP_VERBS[group]] },
    { locale },
  );
}

/** Tap a hero button the way a client would: approvals confirm, changes carry a note. */
async function tapHeroButton(group: keyof typeof GROUP_VERBS, button: string, locale: 'en' | 'ar-EG' = 'en') {
  if (button === 'changes') {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'More light' } });
  }
  fireEvent.click(screen.getByRole('button', { name: messageAt(locale, `delivery.hero.${group}.${button}`) }));
  if (button !== 'changes') await answerDialog(locale, 'confirm');
  await act(async () => {});
}

beforeEach(() => {
  actions.recordDeliveryAction.mockReset();
  actions.respondToDeliveryConcept.mockReset();
  router.refresh.mockReset();
});

describe('the confirmation says "notified" only when the studio was', () => {
  it.each([
    ['concept', 'approve', 'approve_concept', 'approvedBody'],
    ['concept', 'changes', 'request_concept_changes', 'changesBody'],
    ['design', 'approve', 'approve_design', 'approvedBody'],
    ['design', 'changes', 'request_design_changes', 'changesBody'],
    ['handoff', 'acknowledge', 'acknowledge_handoff', 'acknowledgedBody'],
  ] as const)('%s %s', async (group, button, verb, bodyKey) => {
    const isConcept = group === 'concept';
    const action = isConcept ? actions.respondToDeliveryConcept : actions.recordDeliveryAction;
    const answer = (studioNotified: boolean) =>
      isConcept
        ? { kind: verb === 'approve_concept' ? 'approved' : 'changes_requested', studioNotified }
        : { ok: true, studioNotified };

    action.mockResolvedValue(answer(true));
    const notified = renderHero(group);
    await tapHeroButton(group, button);
    expect(await screen.findByText(en(`delivery.hero.${group}.${bodyKey}Notified`))).toBeTruthy();
    expect(action).toHaveBeenCalledWith('tok', verb, button === 'changes' ? 'More light' : '');
    notified.unmount();

    action.mockResolvedValue(answer(false));
    renderHero(group);
    await tapHeroButton(group, button);
    expect(await screen.findByText(en(`delivery.hero.${group}.${bodyKey}`))).toBeTruthy();
    expect(screen.queryByText(en(`delivery.hero.${group}.${bodyKey}Notified`))).toBeNull();
  });

  it('a design repeat (`already`, never notified) reads as recorded, in Arabic too', async () => {
    actions.recordDeliveryAction.mockResolvedValue({ ok: true, code: 'already', studioNotified: false });
    renderHero('design', 'ar-EG');
    await tapHeroButton('design', 'approve', 'ar-EG');
    expect(await screen.findByText(messageAt('ar-EG', 'delivery.hero.design.approvedBody'))).toBeTruthy();
  });
});

describe('a concept verb confirms only what is SAVED (B12)', () => {
  it('a stale Approve over a saved choice of B says "You chose option B", not "approved"', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'chosen', letter: 'B', studioNotified: true });
    renderHero('concept');
    await tapHeroButton('concept', 'approve');
    expect(
      await screen.findByText(en('delivery.conceptPicker.chosen').replace('{letter}', '⁨B⁩')),
    ).toBeTruthy();
    expect(actions.recordDeliveryAction).not.toHaveBeenCalled();
  });

  it('a stale Approve over a saved request for changes confirms the request', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'changes_requested', studioNotified: false });
    renderHero('concept');
    await tapHeroButton('concept', 'approve');
    expect(await screen.findByText(en('delivery.hero.concept.changesTitle'))).toBeTruthy();
    expect(screen.queryByText(en('delivery.hero.concept.approvedTitle'))).toBeNull();
  });

  it('a repeat with nothing live on file says the step moved on and refreshes', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'moved_on' });
    renderHero('concept');
    await tapHeroButton('concept', 'changes');
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.conceptPicker.movedOn'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en('delivery.hero.concept.changesTitle'))).toBeNull();
  });
});
