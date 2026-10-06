import { describe, expect, test } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { EngagementStageSpine } from './engagement-stage-spine';

// jsdom has no layout, so the widths are a live check (R2). What is pinned here
// is the CSS contract that makes overlap impossible: from md up every stage is
// at least as wide as its one-line label, and the band scrolls instead.
describe('EngagementStageSpine layout contract', () => {
  test('from md up a stage never shrinks below its one-line label; the band scrolls', () => {
    const { container } = renderWithIntl(<EngagementStageSpine state="design_3d" />, {
      locale: 'ar-EG',
    });
    const band = container.querySelector('ol')!;
    expect(band.className).toContain('overflow-x-auto');
    const stages = [...container.querySelectorAll('[data-spine-stage]')];
    expect(stages).toHaveLength(8);
    for (const stage of stages) expect(stage.className).toContain('md:min-w-max');
    const labels = [...container.querySelectorAll('[data-spine-label]')];
    expect(labels).toHaveLength(8);
    for (const label of labels) {
      expect(label.className).toContain('md:whitespace-nowrap');
      expect(label.className).toContain('text-caption');
    }
  });
});
