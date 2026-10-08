import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { HeroCard } from './hero-card';

// The hero's confirmation says the designer HAS BEEN NOTIFIED only when the
// portal action says a notification row was written for this act; otherwise it
// says the answer is recorded and the designer will see it. It offers only the
// verbs the client is offered, and a concept verb confirms the decision SAVED
// on file (a repeat shows that one, never the verb just tapped).

const actions = vi.hoisted(() => ({
  recordDeliveryAction: vi.fn(),
  chooseDeliveryConcept: vi.fn(),
  respondToDeliveryConcept: vi.fn(),
}));
vi.mock('../actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

/** Every verb of each group, as the SDF offers them on a fresh review. */
const GROUP_VERBS = {
  concept: ['approve_concept', 'request_concept_changes'],
  design: ['approve_design', 'request_design_changes'],
  handoff: ['acknowledge_handoff'],
} as const;

const LABEL = { ar: 'مراجعة', en: 'Review' };

const OPTION_A = '11111111-1111-4111-8111-111111111111';
const OPTION_B = '22222222-2222-4222-8222-222222222222';
const TWO_OPTIONS = [
  { id: OPTION_A, position: 1 as const, letter: 'A' as const },
  { id: OPTION_B, position: 2 as const, letter: 'B' as const },
];

function renderHero(
  group: 'concept' | 'design' | 'handoff',
  locale: TestLocale,
  concept: Partial<Pick<Parameters<typeof HeroCard>[0], 'clientActions' | 'conceptOptions'>> = {},
) {
  return renderWithIntl(
    <HeroCard
      token="tok"
      hero={{ kind: 'action', group, showRomAck: false }}
      stageLabel={LABEL}
      stageNote={LABEL}
      clientActions={concept.clientActions ?? [...GROUP_VERBS[group]]}
      conceptOptions={concept.conceptOptions ?? []}
      conceptChoice={null}
    />,
    { locale },
  );
}

beforeEach(() => {
  actions.recordDeliveryAction.mockReset();
  actions.respondToDeliveryConcept.mockReset();
  router.refresh.mockReset();
});

describe('HeroCard confirmation', () => {
  it.each([
    ['concept', 'approve', 'approve_concept', 'approvedBody'],
    ['concept', 'changes', 'request_concept_changes', 'changesBody'],
    ['design', 'approve', 'approve_design', 'approvedBody'],
    ['design', 'changes', 'request_design_changes', 'changesBody'],
    ['handoff', 'acknowledge', 'acknowledge_handoff', 'acknowledgedBody'],
  ] as const)(
    '%s %s: "notified" copy only when the studio was notified',
    async (group, buttonKey, verb, bodyKey) => {
      const button = messageAt('en', `delivery.hero.${group}.${buttonKey}`);
      // A concept verb answers an outcome (the decision on file); the others a result.
      const isConcept = group === 'concept';
      const action = isConcept ? actions.respondToDeliveryConcept : actions.recordDeliveryAction;
      const answer = (studioNotified: boolean) =>
        isConcept
          ? { kind: verb === 'approve_concept' ? 'approved' : 'changes_requested', studioNotified }
          : { ok: true, studioNotified };

      action.mockResolvedValue(answer(true));
      const notified = renderHero(group, 'en');
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(
        await screen.findByText(messageAt('en', `delivery.hero.${group}.${bodyKey}Notified`)),
      ).toBeTruthy();
      expect(action).toHaveBeenCalledWith('tok', verb, '');
      notified.unmount();

      action.mockResolvedValue(answer(false));
      renderHero(group, 'en');
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByText(messageAt('en', `delivery.hero.${group}.${bodyKey}`))).toBeTruthy();
      expect(
        screen.queryByText(messageAt('en', `delivery.hero.${group}.${bodyKey}Notified`)),
      ).toBeNull();
    },
  );

  it('a design repeat (`already`, never notified) reads as recorded, in Arabic too', async () => {
    actions.recordDeliveryAction.mockResolvedValue({ ok: true, code: 'already', studioNotified: false });
    renderHero('design', 'ar-EG');
    fireEvent.click(screen.getByRole('button', { name: messageAt('ar-EG', 'delivery.hero.design.approve') }));
    expect(await screen.findByText(messageAt('ar-EG', 'delivery.hero.design.approvedBody'))).toBeTruthy();
  });
});

describe('HeroCard at the concept review (B12)', () => {
  const offered = ['approve_concept', 'request_concept_changes'];

  it('with 2 to 4 released options it is the picker: no plain Approve, Request changes kept', () => {
    renderHero('concept', 'en', { clientActions: offered, conceptOptions: TWO_OPTIONS });
    expect(screen.getByText(messageAt('en', 'delivery.conceptPicker.title'))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: messageAt('en', 'delivery.conceptPicker.choose') })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: messageAt('en', 'delivery.hero.concept.approve') })).toBeNull();
    expect(screen.getByRole('button', { name: messageAt('en', 'delivery.hero.concept.changes') })).toBeTruthy();
  });

  it.each([
    ['no option', []],
    ['one option', TWO_OPTIONS.slice(0, 1)],
  ])('with %s it keeps the plain Approve / Request changes', (_label, conceptOptions) => {
    renderHero('concept', 'en', { clientActions: offered, conceptOptions });
    expect(screen.getByRole('button', { name: messageAt('en', 'delivery.hero.concept.approve') })).toBeTruthy();
    expect(screen.queryByText(messageAt('en', 'delivery.conceptPicker.title'))).toBeNull();
  });

  it('without approve_concept on offer it is not the picker', () => {
    renderHero('concept', 'en', { clientActions: ['request_concept_changes'], conceptOptions: TWO_OPTIONS });
    expect(screen.queryByText(messageAt('en', 'delivery.conceptPicker.title'))).toBeNull();
  });
});

describe('the calm hero repeats the saved choice (B12)', () => {
  function renderCalm(kind: 'inProgress' | 'delivered' | 'closed', locale: TestLocale) {
    return renderWithIntl(
      <HeroCard
        token="tok"
        hero={{ kind, showRomAck: false }}
        stageLabel={LABEL}
        stageNote={LABEL}
        clientActions={[]}
        conceptOptions={[]}
        conceptChoice={{ id: OPTION_B, letter: 'B' }}
      />,
      { locale },
    );
  }

  it('names the letter saved with the choice, in both locales', () => {
    const english = renderCalm('inProgress', 'en');
    expect(screen.getByText('You chose option ⁨B⁩.')).toBeTruthy();
    english.unmount();
    renderCalm('delivered', 'ar-EG');
    expect(screen.getByText('اخترتَ البديل ⁨B⁩.')).toBeTruthy();
  });

  it('says nothing about it once the delivery is closed', () => {
    renderCalm('closed', 'en');
    expect(screen.queryByText(/You chose option/)).toBeNull();
  });
});

describe('ActionHero offers only what is offered, and confirms only what is SAVED (B12)', () => {
  const approve = () => screen.queryByRole('button', { name: messageAt('en', 'delivery.hero.concept.approve') });
  const changes = () => screen.queryByRole('button', { name: messageAt('en', 'delivery.hero.concept.changes') });

  it('a retracted change request still holding its slot: Request changes is not offered', () => {
    renderHero('concept', 'en', { clientActions: ['approve_concept'] });
    expect(approve()).toBeTruthy();
    expect(changes()).toBeNull();
  });

  it('a retracted approval holding its slot: only Request changes is offered', () => {
    renderHero('concept', 'en', { clientActions: ['request_concept_changes'] });
    expect(approve()).toBeNull();
    expect(changes()).toBeTruthy();
  });

  it('a stale Approve over a saved choice of B says "You chose option B", not "approved"', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'chosen', letter: 'B', studioNotified: true });
    renderHero('concept', 'en');
    fireEvent.click(approve()!);
    expect(
      await screen.findByText(messageAt('en', 'delivery.conceptPicker.chosen').replace('{letter}', '\u2068B\u2069')),
    ).toBeTruthy();
    expect(actions.recordDeliveryAction).not.toHaveBeenCalled();
  });

  it('a stale Approve over a saved request for changes confirms the request', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'changes_requested', studioNotified: false });
    renderHero('concept', 'en');
    fireEvent.click(approve()!);
    expect(await screen.findByText(messageAt('en', 'delivery.hero.concept.changesTitle'))).toBeTruthy();
    expect(screen.queryByText(messageAt('en', 'delivery.hero.concept.approvedTitle'))).toBeNull();
  });

  it('a repeat with nothing live on file says the step moved on and refreshes', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'moved_on' });
    renderHero('concept', 'en');
    fireEvent.click(changes()!);
    expect((await screen.findByRole('alert')).textContent).toBe(
      messageAt('en', 'delivery.conceptPicker.movedOn'),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(messageAt('en', 'delivery.hero.concept.changesTitle'))).toBeNull();
  });
});
