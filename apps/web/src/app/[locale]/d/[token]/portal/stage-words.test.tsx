import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { HeroCard } from './hero-card';

// The client's stage words come from the catalog (`delivery.stage.*`), never
// from a TS table, so the i18n gate checks them.

vi.mock('../review-actions', () => ({}));
vi.mock('../actions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderCalm(kind: 'inProgress' | 'delivered' | 'closed', locale: TestLocale, feeAwaited = false) {
  return renderWithIntl(
    <HeroCard
      token="tok"
      hero={{ kind, showRomAck: false }}
      stageKey={kind === 'delivered' ? 'delivered' : kind === 'closed' ? 'closed' : 'drawings'}
      review={{ clientActions: [], conceptOptions: [], conceptChoice: null, conceptDecision: null, documents: [], rom: null, rendersIssuedAt: null, expectedOn: null, timeline: [] }}
      lastAnswer={null}
      onAnswered={() => {}}
      feeAwaited={feeAwaited}
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

  it.each(['en', 'ar-EG'] as const)('in progress with a fee awaited (%s): the stage note, never "nothing to do"', (locale) => {
    renderCalm('inProgress', locale, true);
    expect(screen.getByText(messageAt(locale, 'delivery.stage.drawings.note'))).toBeTruthy();
    expect(screen.queryByText(messageAt(locale, 'delivery.hero.reassurance'))).toBeNull();
    expect(screen.getByText(messageAt(locale, 'delivery.hero.inProgressTag'))).toBeTruthy();
  });

  it.each(['en', 'ar-EG'] as const)('delivered (%s): the stage label and its note', (locale) => {
    renderCalm('delivered', locale);
    expect(screen.getByRole('heading').textContent).toBe(messageAt(locale, 'delivery.stage.delivered.label'));
    expect(screen.getByText(messageAt(locale, 'delivery.stage.delivered.note'))).toBeTruthy();
  });
});
