import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderCommandCard } from '@/test/portal-command-card';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { BudgetCard } from './budget-card';

// AC 50 and the budget card's date: an in-progress hero says when the studio
// expects the next step; a delivered one, on which day; the budget card, when
// the client saw this range.

vi.mock('../review-actions', () => ({}));
vi.mock('../actions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const en = (path: string) => messageAt('en', path);
const CALM = { kind: 'inProgress', showRomAck: false } as const;

describe('the calm hero dates', () => {
  it.each(['en', 'ar-EG'] as const)('in progress with an expected day (%s)', (locale) => {
    renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'drawings', expectedOn: '2026-10-20' }, { locale });
    expect(screen.getByText(messageAt(locale, 'delivery.hero.expectedBy').replace('{date}', '⁨20/10/2026⁩'))).toBeTruthy();
  });

  it('no expected day: no line', () => {
    renderCommandCard({ hero: CALM, clientActions: [], stageKey: 'drawings' });
    expect(screen.queryByText(/Expected by/)).toBeNull();
  });

  it('delivered: "Delivered on {date}. Thank you." from the newest delivered stage move', () => {
    renderCommandCard({
      hero: { kind: 'delivered', showRomAck: false },
      clientActions: [],
      stageKey: 'delivered',
      timeline: [
        { type: 'stage', stageKey: 'delivered', at: '2026-10-08T10:00:00.000Z' },
        { type: 'decision', decision: 'handover_acknowledged', byStudio: false, letter: null, at: '2026-10-08T10:00:00.000Z' },
      ],
    });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      en('delivery.hero.deliveredOn').replace('{date}', '⁨08/10/2026⁩'),
    );
  });

  it('delivered with no dated move: the stage label', () => {
    renderCommandCard({ hero: { kind: 'delivered', showRomAck: false }, clientActions: [], stageKey: 'delivered' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(en('delivery.stage.delivered.label'));
  });
});

describe('the budget card date', () => {
  it('says on which day the client saw this range, with no button', () => {
    const rom = { low: '900000.0000', high: '1200000.0000' };
    renderWithIntl(<BudgetCard token="tok" rom={rom} canAcknowledge={false} acknowledgedAt="2026-09-30T10:00:00.000Z" />, {
      locale: 'en',
    });
    expect(screen.getByRole('status').textContent).toBe(en('delivery.budget.acknowledgedOn').replace('{date}', '⁨30/09/2026⁩'));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
