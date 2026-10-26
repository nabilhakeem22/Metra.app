import { Box, FileText, LayoutGrid, PackageCheck, Palette, PenTool, Ruler, Table2 } from 'lucide-react';
import { describe, expect, test } from 'vitest';
import { JOURNEY_MILESTONES } from '@/lib/engagements/journey-map';
import { SPINE_NODES } from '@/lib/engagements/stage-spine';
import { buildPhaseView } from '@/lib/flow/build-view';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';
import { EXECUTION_PHASE } from '@/lib/flow/phases/execution';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { EXECUTION_STEP_ICON } from './execution-step-icons';
import { PhaseRail } from './phase-rail';

const LOCALES: TestLocale[] = ['ar-EG', 'en'];

const STAGE_ICONS = {
  proposal: FileText,
  survey: Ruler,
  layout: LayoutGrid,
  concept: Palette,
  threeD: Box,
  shopDrawings: PenTool,
  boq: Table2,
  handover: PackageCheck,
};

const studioLabels = (locale: TestLocale) =>
  Object.fromEntries(SPINE_NODES.map((node) => [node.key, messageAt(locale, `engagements.spine.${node.key}`)]));

const clientLabels = (locale: TestLocale) =>
  Object.fromEntries(JOURNEY_MILESTONES.map((key) => [key, messageAt(locale, `delivery.journey.${key}`)]));

const CLIENT_ICONS = Object.fromEntries(JOURNEY_MILESTONES.map((key) => [key, FileText]));

/** A physical inline direction in a class (left, right, ml-, pr-...) would not mirror in RTL. */
const PHYSICAL = /(^|\s|:)(left|right|[mp][lr]-|border-[lr]|rounded-[lr]|text-left|text-right)/;

describe('PhaseRail', () => {
  test.each(LOCALES)('renders the studio design phase from %s strings, in a right-to-left page too', (locale) => {
    const view = buildPhaseView(DESIGN_PHASE, { step: 'concept', whoseMove: 'client', status: 'active', atGate: 'gateA' }, 'studio');
    const { container } = renderWithIntl(
      <div dir={locale === 'ar-EG' ? 'rtl' : 'ltr'}>
        <PhaseRail view={view} labels={studioLabels(locale)} icons={STAGE_ICONS} />
      </div>,
      { locale },
    );
    const items = [...container.querySelectorAll('ol > li')];
    expect(items.map((item) => item.textContent)).toEqual(Object.values(studioLabels(locale)));
    // Done and current carry their glyph; the rest carry a dot.
    expect(container.querySelectorAll('[data-rail-step] svg')).toHaveLength(4);
    const current = [...container.querySelectorAll('[aria-current="step"]')].map((item) => item.textContent);
    expect(current).toEqual([messageAt(locale, 'engagements.spine.concept'), messageAt(locale, 'engagements.spine.gateA')]);
    for (const element of container.querySelectorAll('[class]')) {
      expect(element.getAttribute('class'), element.outerHTML).not.toMatch(PHYSICAL);
    }
  });

  test.each(LOCALES)('renders the client journey from %s strings with no gate', (locale) => {
    const view = buildPhaseView(DESIGN_PHASE, { step: 'design', whoseMove: 'client', status: 'active' }, 'client');
    const { container } = renderWithIntl(<PhaseRail view={view} labels={clientLabels(locale)} icons={CLIENT_ICONS} />, {
      locale,
    });
    expect([...container.querySelectorAll('ol > li')].map((item) => item.textContent)).toEqual(
      JOURNEY_MILESTONES.map((key) => messageAt(locale, `delivery.journey.${key}`)),
    );
    expect(container.querySelector('[aria-current="step"]')?.textContent).toBe(messageAt(locale, 'delivery.journey.design'));
  });

  test('keeps the layout contract: the band scrolls, and from md up no step shrinks below its one-line label', () => {
    // happy-dom has no layout, so the widths are a live check. What is pinned
    // here is the CSS contract that makes overlapping labels impossible.
    const view = buildPhaseView(DESIGN_PHASE, { step: 'threeD', whoseMove: 'studio', status: 'active' }, 'studio');
    const { container } = renderWithIntl(<PhaseRail view={view} labels={studioLabels('ar-EG')} icons={STAGE_ICONS} />);
    expect(container.querySelector('ol')!.className).toContain('overflow-x-auto');
    const steps = [...container.querySelectorAll('[data-rail-step]')];
    expect(steps).toHaveLength(8);
    for (const step of steps) expect(step.className).toContain('md:min-w-max');
    const labels = [...container.querySelectorAll('[data-rail-label]')];
    expect(labels).toHaveLength(8);
    for (const label of labels) {
      expect(label.className).toContain('md:whitespace-nowrap');
      expect(label.className).toContain('text-caption');
    }
  });

  test.each(LOCALES)('draws a whose-move chip and caption under a step given a %s note', (locale) => {
    const view = buildPhaseView(DESIGN_PHASE, { step: 'survey', whoseMove: 'studio', status: 'active' }, 'studio');
    const who = messageAt(locale, 'engagements.command.nextAction');
    const caption = messageAt(locale, 'engagements.command.pill.waitingClient');
    const { container } = renderWithIntl(
      <PhaseRail
        view={view}
        labels={studioLabels(locale)}
        icons={STAGE_ICONS}
        notes={{ survey: { who, caption }, proposal: { who } }}
      />,
      { locale },
    );
    const chips = [...container.querySelectorAll('[data-rail-who] [data-tone]')];
    expect(chips.map((chip) => chip.getAttribute('data-tone'))).toEqual(['done', 'yourMove']);
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain(caption);
    // A phone draws the step names alone: a chip would run into the next, narrow, step.
    for (const chip of container.querySelectorAll('[data-rail-who]')) {
      expect(chip.parentElement!.className).toMatch(/(^| )hidden( |$)/);
      expect(chip.parentElement!.className).toMatch(/(^| )md:flex( |$)/);
    }
  });

  // H4 follow-up 3: at 390 px five client names were clipped to "Contr" and "Signa".
  describe.each(LOCALES)('the compact variant below sm (%s)', (locale) => {
    const PHONE_ONLY_SR = '[@media(max-width:639.98px)]:sr-only';
    const labels = Object.fromEntries(EXECUTION_PHASE.steps.map((step) => [step.key, messageAt(locale, `delivery.flow.execution.${step.key}`)]));

    test('leaves every step name to screen readers on a phone, and names the current step once, in full, under the rail', () => {
      const view = buildPhaseView(EXECUTION_PHASE, { step: 'signature', whoseMove: 'client', status: 'active' }, 'client');
      const { container } = renderWithIntl(<PhaseRail view={view} labels={labels} icons={EXECUTION_STEP_ICON} compactBelowSm />, { locale });
      const names = [...container.querySelectorAll('[data-rail-label]')];
      expect(names.map((name) => name.textContent)).toEqual(Object.values(labels));
      for (const name of names) expect(name.className.split(' ')).toContain(PHONE_ONLY_SR);
      const current = container.querySelector('[data-rail-current-name]')!;
      expect(current.textContent).toBe(labels.signature);
      expect(current.getAttribute('aria-hidden')).toBe('true');
      expect(current.className.split(' ')).toContain('sm:hidden');
    });

    test('says no current name once nothing is current, and the full rail is unchanged', () => {
      const settled = buildPhaseView(EXECUTION_PHASE, { step: 'settled', whoseMove: null, status: 'complete' }, 'client');
      const compact = renderWithIntl(<PhaseRail view={settled} labels={labels} icons={EXECUTION_STEP_ICON} compactBelowSm />, { locale });
      expect(compact.container.querySelector('[data-rail-current-name]')).toBeNull();
      compact.unmount();
      const active = buildPhaseView(EXECUTION_PHASE, { step: 'works', whoseMove: 'site', status: 'active' }, 'client');
      const { container } = renderWithIntl(<PhaseRail view={active} labels={labels} icons={EXECUTION_STEP_ICON} />, { locale });
      expect(container.querySelector('[data-rail-current-name]')).toBeNull();
      for (const name of container.querySelectorAll('[data-rail-label]')) expect(name.className).not.toContain('sr-only');
    });
  });

  test('refuses to draw a step it has no name for', () => {
    const view = buildPhaseView(DESIGN_PHASE, { step: 'survey', whoseMove: 'studio', status: 'active' }, 'studio');
    const { gateB: _dropped, ...labels } = studioLabels('en');
    expect(() => renderWithIntl(<PhaseRail view={view} labels={labels} icons={STAGE_ICONS} />)).toThrow(
      /no label for gateB/,
    );
  });
});
