import { describe, expect, it } from 'vitest';
import { whoseMoveTone } from './whose-move-tone';

describe('whoseMoveTone', () => {
  it('wears brand only for the studio holding the current step', () => {
    expect(whoseMoveTone('studio', 'current')).toBe('yourMove');
    expect(whoseMoveTone('client', 'current')).toBe('waiting');
    expect(whoseMoveTone('site', 'current')).toBe('neutral');
  });

  it('is done behind the job and neutral ahead of it, whoever holds the step', () => {
    for (const actor of ['studio', 'client', 'site'] as const) {
      expect(whoseMoveTone(actor, 'done')).toBe('done');
      expect(whoseMoveTone(actor, 'upcoming')).toBe('neutral');
    }
  });
});
