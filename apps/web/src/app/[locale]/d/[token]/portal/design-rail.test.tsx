import { describe, expect, it } from 'vitest';
import { JOURNEY_MILESTONES, stateMilestone } from '@/lib/engagements/journey-map';
import { deriveHero } from '@/lib/engagements/portal-hero';
import { PORTAL_STAGE_KEY } from '@/lib/engagements/portal-stage';
import { DESIGN_STATES, type DesignState } from '@/lib/engagements/states';
import { buildPhaseView } from '@/lib/flow/build-view';
import { locateDesignForClient } from '@/lib/flow/locate/design-client';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { DesignRail } from './design-rail';

/** The verbs a client could be offered at each state, so the hero is the one `deriveHero` gives. */
const VERBS: Partial<Record<DesignState, string[]>> = {
  concept_review: ['approve_concept', 'request_concept_changes'],
  final_approval: ['approve_design', 'request_design_changes'],
  design_only_handoff: ['acknowledge_handoff'],
};

function renderAt(state: DesignState, locale: TestLocale) {
  const location = locateDesignForClient({
    milestone: stateMilestone(state),
    stageKey: PORTAL_STAGE_KEY[state],
    hero: deriveHero(VERBS[state] ?? [], state),
    paymentSchedule: [],
    paymentClaim: null,
    designDecision: null,
    conceptDecision: null,
  });
  return renderWithIntl(<DesignRail view={buildPhaseView(DESIGN_PHASE, location, 'client')} />, { locale });
}

const LOCALES: TestLocale[] = ['en', 'ar-EG'];
const ON_THE_RAIL = DESIGN_STATES.filter((state) => state !== 'abandoned' && state !== 'execution' && state !== 'closed_design_only');

describe('the client design rail', () => {
  it.each(LOCALES)('draws the six client steps in order, with no gate (%s)', (locale) => {
    const { container } = renderAt('concept_review', locale);
    const steps = [...container.querySelectorAll('[data-rail-step]')];
    expect(steps.map((step) => step.textContent)).toEqual(JOURNEY_MILESTONES.map((key) => messageAt(locale, `delivery.journey.${key}`)));
    expect(container.querySelectorAll('li')).toHaveLength(6);
  });

  it.each(LOCALES)('every design state on the rail has its milestone as the one current step, named once (%s)', (locale) => {
    for (const state of ON_THE_RAIL) {
      const { container, unmount } = renderAt(state, locale);
      const current = [...container.querySelectorAll('[aria-current="step"]')];
      const label = messageAt(locale, `delivery.journey.${JOURNEY_MILESTONES[stateMilestone(state).index]}`);
      expect(current, state).toHaveLength(1);
      expect(current[0].textContent, state).toBe(label);
      expect(container.querySelector('[data-rail-current-name]')?.textContent, state).toBe(label);
      unmount();
    }
  });

  it.each<DesignState>(['closed_design_only', 'execution'])('at %s every step is done and none current, with no current name', (state) => {
    const { container } = renderAt(state, 'en');
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect(container.querySelector('[data-rail-current-name]')).toBeNull();
    expect(container.querySelectorAll('[data-rail-step] .bg-\\[color\\:var\\(--spine-done\\)\\]')).toHaveLength(6);
  });

  it('abandoned mutes every bar, with no current step', () => {
    const { container } = renderAt('abandoned', 'en');
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-rail-step] .bg-\\[color\\:var\\(--rule\\)\\]')).toHaveLength(6);
    expect(container.querySelector('[data-rail-current-name]')).toBeNull();
  });

  it('leaves each name to screen readers below sm: the compact rail', () => {
    const { container } = renderAt('survey', 'en');
    const labels = [...container.querySelectorAll('[data-rail-label]')];
    expect(labels).toHaveLength(6);
    for (const label of labels) expect(label.className).toContain('[@media(max-width:639.98px)]:sr-only');
  });

  it('wraps each name under its mark rather than scrolling: never one line, never clamped, and no step floor below sm', () => {
    const { container } = renderAt('survey', 'en');
    for (const label of container.querySelectorAll('[data-rail-label]')) {
      expect(label.className).not.toContain('whitespace-nowrap');
      expect(label.className).not.toContain('line-clamp');
    }
    for (const step of container.querySelectorAll('[data-rail-step]')) {
      expect(step.className).not.toContain('min-w-max');
      expect(step.className).not.toContain('min-w-[52px]');
    }
  });
});
