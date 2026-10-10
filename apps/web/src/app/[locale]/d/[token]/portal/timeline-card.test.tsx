import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PortalTimelineEntry } from '@/lib/engagements/public/types';
import { DESIGN_STATES } from '@/lib/engagements/states';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { TIMELINE_VISIBLE, TimelineCard } from './timeline-card';

// AC 49: "What happened", dated (Cairo, Latin digits), newest first in the
// order given, "Last update", the studio-recorded acts labelled as such, and
// no machine word anywhere.

const STORY: PortalTimelineEntry[] = [
  { type: 'stage', stageKey: 'drawings', at: '2026-10-05T09:00:00.000Z' },
  { type: 'decision', decision: 'design_approved', byStudio: true, letter: null, at: '2026-10-05T09:00:00.000Z' },
  { type: 'payment', kind: 'gate_b', amount: '25000.0000', at: '2026-10-03T09:00:00.000Z' },
  { type: 'decision', decision: 'concept_chosen', byStudio: false, letter: 'B', at: '2026-09-20T09:00:00.000Z' },
];

function renderCard(locale: TestLocale, timeline = STORY, lastUpdateAt: string | null = '2026-10-06T21:30:00.000Z') {
  return renderWithIntl(<TimelineCard timeline={timeline} lastUpdateAt={lastUpdateAt} />, { locale });
}

describe('TimelineCard', () => {
  it.each(['en', 'ar-EG'] as const)('dated entries in the given order, with the last update (%s)', (locale) => {
    renderCard(locale);
    const card = screen.getByRole('region', { name: messageAt(locale, 'delivery.timeline.title') });
    // 21:30 UTC is already the 7th in Cairo.
    expect(card.textContent).toContain('07/10/2026');
    const lines = within(card).getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(lines[0]).toContain(messageAt(locale, 'delivery.stage.drawings.label'));
    expect(lines[0]).toContain('05/10/2026');
    expect(lines[1]).toContain(
      messageAt(locale, 'delivery.timeline.recordedByStudio').replace(
        '{decision}',
        messageAt(locale, 'delivery.timeline.decision.design_approved'),
      ),
    );
    expect(lines[2]).toContain(messageAt(locale, 'delivery.payments.kind.gate_b'));
    expect(lines[3]).toContain('B');
    expect(lines[3]).not.toContain(messageAt(locale, 'delivery.timeline.recordedByStudio').replace('{decision}', ''));
    expect(card.textContent).not.toMatch(/[٠-٩]/);
    for (const state of DESIGN_STATES) expect(card.textContent).not.toContain(state);
  });

  it('shows the newest six, then everything on "Show all"', () => {
    const many: PortalTimelineEntry[] = Array.from({ length: 9 }, (_, index) => ({
      type: 'payment',
      kind: 'deposit',
      amount: `${index + 1}.0000`,
      at: `2026-10-0${index + 1}T09:00:00.000Z`,
    }));
    renderCard('en', many);
    expect(screen.getAllByRole('listitem')).toHaveLength(TIMELINE_VISIBLE);
    const toggle = screen.getByRole('button', { name: 'Show all (9)' });
    expect(toggle.className).toMatch(/(^|\s)min-h-11(\s|$)/);
    fireEvent.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders nothing before anything happened', () => {
    const { container } = renderCard('en', [], null);
    expect(container.textContent).toBe('');
  });
});
