import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { HeroCard } from './hero-card';

// The hero's confirmation says the designer HAS BEEN NOTIFIED only when the
// portal action says a notification row was written for this act; otherwise it
// says the answer is recorded and the designer will see it.

const actions = vi.hoisted(() => ({ recordDeliveryAction: vi.fn() }));
vi.mock('../actions', () => actions);

const LABEL = { ar: 'مراجعة', en: 'Review' };

function renderHero(group: 'concept' | 'design' | 'handoff', locale: TestLocale) {
  return renderWithIntl(
    <HeroCard
      token="tok"
      hero={{ kind: 'action', group, showRomAck: false }}
      stageLabel={LABEL}
      stageNote={LABEL}
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
