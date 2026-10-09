import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { stateMilestone } from '@/lib/engagements/journey-map';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { HeroCard } from './hero-card';
import { JourneyTracker } from './journey-tracker';

// The client's stage words come from the catalog (`delivery.stage.*`,
// `delivery.journey.*`), never from a TS table, so the i18n gate checks them.

vi.mock('../actions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderCalm(kind: 'inProgress' | 'delivered' | 'closed', locale: TestLocale) {
  return renderWithIntl(
    <HeroCard
      token="tok"
      hero={{ kind, showRomAck: false }}
      stageKey={kind === 'delivered' ? 'delivered' : kind === 'closed' ? 'closed' : 'drawings'}
      clientActions={[]}
      conceptOptions={[]}
      conceptChoice={null}
      conceptDecision={null}
      lastAnswer={null}
      onAnswered={() => {}}
    />,
    { locale },
  );
}

describe('the calm hero reads its stage from the catalog', () => {
  it.each(['en', 'ar-EG'] as const)('in progress (%s): the stage label, then the reassurance', (locale) => {
    renderCalm('inProgress', locale);
    expect(screen.getByRole('heading').textContent).toBe(messageAt(locale, 'delivery.stage.drawings.label'));
    expect(screen.getByText(messageAt(locale, 'delivery.hero.reassurance'))).toBeTruthy();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.inProgressTag'))).toBeTruthy();
  });

  it.each(['en', 'ar-EG'] as const)('delivered (%s): the stage label and its note', (locale) => {
    renderCalm('delivered', locale);
    expect(screen.getByRole('heading').textContent).toBe(messageAt(locale, 'delivery.stage.delivered.label'));
    expect(screen.getByText(messageAt(locale, 'delivery.stage.delivered.note'))).toBeTruthy();
  });
});

describe('the journey tracker', () => {
  it.each(['en', 'ar-EG'] as const)('at the final approval the current milestone is Design (%s)', (locale) => {
    renderWithIntl(<JourneyTracker milestone={stateMilestone('final_approval')} bare />, { locale });
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    const current = steps.filter((step) => step.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain(messageAt(locale, 'delivery.journey.design'));
    // Named once on screen, beside the eyebrow; the other five only for a screen reader.
    expect(screen.getAllByText(messageAt(locale, 'delivery.journey.design'))).toHaveLength(2);
    expect(steps.filter((step) => step.querySelector('.sr-only'))).toHaveLength(6);
  });

  it('a delivered design marks all six done and none current', () => {
    renderWithIntl(<JourneyTracker milestone={stateMilestone('closed_design_only')} bare />, { locale: 'en' });
    expect(screen.getAllByRole('listitem').filter((step) => step.hasAttribute('aria-current'))).toHaveLength(0);
  });
});
