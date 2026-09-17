import { describe, expect, it } from 'vitest';
import {
  cardTop,
  clampInset,
  coachmarkKey,
  inlineStartOffset,
  ANCHOR_GAP,
  VIEWPORT_MARGIN,
  resolveCoachmarkPlacement,
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

describe('resolveCoachmarkPlacement', () => {
  const viewport = { width: 1200, height: 800 };
  const card = { width: 288, height: 168 };
  const anchor = { top: 100, bottom: 140, nearEdge: 300, farEdge: 460, width: 160, height: 40 };

  it('LTR: the highlight sits at the anchor, the card below it', () => {
    const placement = resolveCoachmarkPlacement({ anchor, card, viewport, rtl: false });
    expect(placement.highlightInset).toBe(300);
    expect(placement.cardInset).toBe(300);
    expect(placement.cardTop).toBe(140 + ANCHOR_GAP);
  });

  // The inset is LOGICAL, so the same number positions correctly in both
  // directions: in RTL it is measured from the physical far edge.
  it('RTL: the inset flips to the distance from the far edge', () => {
    const placement = resolveCoachmarkPlacement({ anchor, card, viewport, rtl: true });
    expect(placement.highlightInset).toBe(1200 - 460);
  });

  it('an anchor at the inline-END edge pulls the card back inside the margin', () => {
    const edge = { ...anchor, nearEdge: 1150, farEdge: 1190 };
    const placement = resolveCoachmarkPlacement({ anchor: edge, card, viewport, rtl: false });
    expect(placement.cardInset).toBe(1200 - 288 - VIEWPORT_MARGIN);
    expect(placement.cardInset + placement.cardWidth).toBeLessThanOrEqual(1200);
  });

  it('an anchor at the inline-START edge is clamped to the margin, not to 0', () => {
    const edge = { ...anchor, nearEdge: 2, farEdge: 40 };
    const placement = resolveCoachmarkPlacement({ anchor: edge, card, viewport, rtl: false });
    expect(placement.cardInset).toBe(VIEWPORT_MARGIN);
  });

  it('no room BELOW flips the card above the anchor', () => {
    const low = { ...anchor, top: 700, bottom: 740 };
    const placement = resolveCoachmarkPlacement({ anchor: low, card, viewport, rtl: false });
    expect(placement.cardTop).toBe(700 - ANCHOR_GAP - card.height);
  });

  it('a card wider than the viewport is narrowed to fit between the margins', () => {
    const narrow = { width: 320, height: 800 };
    const placement = resolveCoachmarkPlacement({
      anchor,
      card: { width: 288, height: 168 },
      viewport: narrow,
      rtl: false,
    });
    expect(placement.cardWidth).toBe(288);
    const wide = resolveCoachmarkPlacement({
      anchor,
      card: { width: 600, height: 168 },
      viewport: narrow,
      rtl: false,
    });
    expect(wide.cardWidth).toBe(320 - VIEWPORT_MARGIN * 2);
  });

  it('a card TALLER than the viewport still lands at the top margin, never negative', () => {
    const tall = { width: 288, height: 900 };
    const placement = resolveCoachmarkPlacement({ anchor, card: tall, viewport, rtl: false });
    expect(placement.cardTop).toBe(VIEWPORT_MARGIN);
  });
});
