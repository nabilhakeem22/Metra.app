import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { StatusTone } from '@/lib/ui/status-tone';
import { StatusChip } from './status-chip';

afterEach(cleanup);

const TONES: StatusTone[] = ['yourMove', 'waiting', 'stalled', 'done', 'draft', 'neutral'];
const ICON: Record<StatusTone, string | null> = {
  yourMove: 'lucide-arrow-right',
  waiting: 'lucide-hourglass',
  stalled: 'lucide-triangle-alert',
  done: 'lucide-check',
  draft: null,
  neutral: null,
};

function chipOf(tone: StatusTone, detail?: string) {
  const { container } = render(<StatusChip tone={tone} label="Label" detail={detail} />);
  return container.querySelector('span[data-tone]') as HTMLElement;
}

describe('StatusChip', () => {
  test.each(TONES)('%s: brand only on yourMove, never red', (tone) => {
    const classes = chipOf(tone).className;
    const branded = /brand-tint|brand-ink/.test(classes);
    expect(branded).toBe(tone === 'yourMove');
    expect(classes).not.toMatch(/danger|destructive/);
  });

  test.each(TONES)('%s renders its own icon (or none)', (tone) => {
    const svg = chipOf(tone).querySelector('svg');
    const expected = ICON[tone];
    if (expected === null) expect(svg).toBeNull();
    else expect(svg?.getAttribute('class')).toContain(expected);
  });

  test('the yourMove arrow flips in RTL and every icon is hidden from AT', () => {
    const svg = chipOf('yourMove').querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('rtl:-scale-x-100');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  test('detail follows the label after a middot', () => {
    expect(chipOf('waiting', '6 days').textContent).toBe('Label·6 days');
    expect(chipOf('waiting').textContent).toBe('Label');
  });
});
