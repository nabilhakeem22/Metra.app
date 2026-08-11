import { describe, expect, it } from 'vitest';
import { coachmarkKey, inlineStartOffset } from './coachmark-logic';

describe('inlineStartOffset (RTL logical inset)', () => {
  it('LTR measures from the near (physical-left) edge', () => {
    expect(inlineStartOffset(100, 260, false, 1000)).toBe(100);
  });
  it('RTL measures from the far (physical-right) edge (flips)', () => {
    expect(inlineStartOffset(100, 260, true, 1000)).toBe(1000 - 260); // 740
  });
});

describe('coachmarkKey mapping', () => {
  it('maps the control keys', () => {
    expect(coachmarkKey('Escape')).toBe('stop');
    expect(coachmarkKey('ArrowRight')).toBe('next');
    expect(coachmarkKey('Enter')).toBe('next');
    expect(coachmarkKey('ArrowLeft')).toBe('prev');
    expect(coachmarkKey('Tab')).toBe('tab');
    expect(coachmarkKey('a')).toBeNull();
  });
});
