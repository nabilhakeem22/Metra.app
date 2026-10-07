import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { HeroCard } from './hero-card';

// The hero's confirmation says the designer HAS BEEN NOTIFIED only when the
// portal action says a notification row was written for this act; otherwise it
// says the answer is recorded and the designer will see it.

const actions = vi.hoisted(() => ({ recordDeliveryAction: vi.fn(), chooseDeliveryConcept: vi.fn() }));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
      clientActions={concept.clientActions ?? []}
      conceptOptions={concept.conceptOptions ?? []}
      conceptChoice={null}
    />,
    { locale },
  );
}

beforeEach(() => {
  actions.recordDeliveryAction.mockReset();
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

      actions.recordDeliveryAction.mockResolvedValue({ ok: true, studioNotified: true });
      const notified = renderHero(group, 'en');
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(
        await screen.findByText(messageAt('en', `delivery.hero.${group}.${bodyKey}Notified`)),
      ).toBeTruthy();
      expect(actions.recordDeliveryAction).toHaveBeenCalledWith('tok', verb, '');
      notified.unmount();

      actions.recordDeliveryAction.mockResolvedValue({ ok: true, studioNotified: false });
      renderHero(group, 'en');
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByText(messageAt('en', `delivery.hero.${group}.${bodyKey}`))).toBeTruthy();
      expect(
        screen.queryByText(messageAt('en', `delivery.hero.${group}.${bodyKey}Notified`)),
      ).toBeNull();
    },
  );

  it('an idempotent repeat (`already`, never notified) reads as recorded, in Arabic too', async () => {
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
