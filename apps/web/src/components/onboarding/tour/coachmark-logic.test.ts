import { describe, expect, it } from 'vitest';
import {
  cardTop,
  clampInset,
  coachmarkKey,
  inlineStartOffset,
} from './coachmark-logic';

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

describe('cardTop (flip above when no room below)', () => {
  const VH = 800;
  const H = 168;
  const GAP = 10;
  const M = 16;
  it('places below the anchor when there is room', () => {
    expect(cardTop(100, 140, H, VH, GAP, M)).toBe(140 + GAP); // 150
  });
  it('flips above when below would overflow the viewport bottom', () => {
    // anchor near the bottom: below (700+10) + 168 + 16 > 800 → flip above
    expect(cardTop(660, 700, H, VH, GAP, M)).toBe(660 - GAP - H); // 482
  });
  it('clamps within the viewport when neither side fully fits', () => {
    const top = cardTop(10, 40, H, VH, GAP, M);
    expect(top).toBeGreaterThanOrEqual(M);
    expect(top + H).toBeLessThanOrEqual(VH - M);
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
