import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { stateMilestone } from '@/lib/engagements/journey-map';
import { PORTAL_STAGE_KEY } from '@/lib/engagements/portal-stage';
import type { DesignState } from '@/lib/engagements/states';
import { buildPhaseView } from '@/lib/flow/build-view';
import { locateDesignForClient } from '@/lib/flow/locate/design-client';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { WhatsNext } from './whats-next';

function viewAt(state: DesignState) {
  const location = locateDesignForClient({
    milestone: stateMilestone(state),
    stageKey: PORTAL_STAGE_KEY[state],
    hero: { kind: 'inProgress', showRomAck: false },
    paymentSchedule: [],
    paymentClaim: null,
  });
  return buildPhaseView(DESIGN_PHASE, location, 'client');
}

describe('WhatsNext', () => {
  it.each<TestLocale>(['en', 'ar-EG'])('names the step after the current one in the same view (%s)', (locale) => {
    const { container } = renderWithIntl(<WhatsNext view={viewAt('concept_review')} />, { locale });
    expect(container.textContent).toContain(messageAt(locale, 'delivery.whatsNext.eyebrow'));
    expect(screen.getByText(messageAt(locale, 'delivery.journey.design'))).toBeTruthy();
  });

  it.each<DesignState>(['design_only_handoff', 'closed_design_only', 'execution', 'abandoned'])('says nothing at %s', (state) => {
    const { container } = renderWithIntl(<WhatsNext view={viewAt(state)} />, { locale: 'en' });
    expect(container.textContent).toBe('');
  });
});
