import { describe, expect, test } from 'vitest';
import { SPINE_NODES } from '@/lib/engagements/stage-spine';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { EngagementStageSpine } from './engagement-stage-spine';

const LOCALES: TestLocale[] = ['ar-EG', 'en'];

describe('EngagementStageSpine', () => {
  test.each(LOCALES)('draws the eight stages and both gates in the spine order, named in %s', (locale) => {
    const { container } = renderWithIntl(<EngagementStageSpine state="design_3d" status={{ kind: 'yourMove' }} />, {
      locale,
    });
    const names = [...container.querySelectorAll('ol > li')].map((item) => item.textContent);
    expect(names).toEqual(SPINE_NODES.map((node) => messageAt(locale, `engagements.spine.${node.key}`)));
    expect(container.querySelectorAll('[data-rail-step]')).toHaveLength(8);
  });

  test('puts the current stage and the gate the delivery waits at in aria-current', () => {
    const { container } = renderWithIntl(
      <EngagementStageSpine state="final_approval" status={{ kind: 'waitingClient', days: 1 }} />,
      { locale: 'en' },
    );
    const current = [...container.querySelectorAll('[aria-current="step"]')].map((item) => item.textContent);
    expect(current).toEqual([messageAt('en', 'engagements.spine.threeD'), messageAt('en', 'engagements.spine.gateB')]);
  });

  test('mutes every stage of an abandoned delivery: no glyph, nothing current', () => {
    const { container } = renderWithIntl(<EngagementStageSpine state="abandoned" status={{ kind: 'abandoned' }} />, {
      locale: 'ar-EG',
    });
    expect(container.querySelector('[aria-current]')).toBeNull();
    expect(container.querySelectorAll('[data-rail-step] svg')).toHaveLength(0);
  });

  test('lights every stage of a delivered one', () => {
    const { container } = renderWithIntl(<EngagementStageSpine state="execution" status={{ kind: 'delivered' }} />, {
      locale: 'ar-EG',
    });
    expect(container.querySelectorAll('[data-rail-step] svg')).toHaveLength(8);
    expect(container.querySelector('[aria-current]')).toBeNull();
  });
});
