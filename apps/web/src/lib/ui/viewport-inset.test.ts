import { describe, expect, it } from 'vitest';
import { clampInset, inlineStartOffset } from './viewport-inset';

describe('inlineStartOffset (RTL logical inset)', () => {
  it('LTR measures from the near (physical-left) edge', () => {
    expect(inlineStartOffset(100, 260, false, 1000)).toBe(100);
  });
  it('RTL measures from the far (physical-right) edge (flips)', () => {
    expect(inlineStartOffset(100, 260, true, 1000)).toBe(1000 - 260); // 740
  });
});

describe('clampInset (keep the card on-screen)', () => {
  const W = 1730;
  const CARD = 288;
  const M = 16;
  it('pulls an anchor near the inline-end edge fully back on-screen', () => {
    // "+ New item" case: anchor inset ~1540 would overflow (1540+288 > 1730)
    const inset = clampInset(1540, CARD, W, M);
    expect(inset).toBe(W - CARD - M); // 1426
    expect(inset + CARD).toBeLessThanOrEqual(W - M); // fully visible
  });
  it('leaves an in-bounds inset untouched', () => {
    expect(clampInset(500, CARD, W, M)).toBe(500);
  });
  it('never goes below the start margin', () => {
    expect(clampInset(-40, CARD, W, M)).toBe(M);
  });
  it('pins to the start margin when the card is wider than the space', () => {
    expect(clampInset(100, CARD, 300, M)).toBe(M);
  });
});
