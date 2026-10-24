import { describe, expect, it } from 'vitest';
import { LAYER_GAP, LAYER_VIEWPORT_MARGIN, anchoredPlacement, type AnchoredPlacementInput } from './anchored-placement';

const VIEWPORT = { width: 1280, height: 900 };
const box = (top: number, nearEdge: number, width = 300, height = 36) => ({ top, bottom: top + height, nearEdge, farEdge: nearEdge + width, width, height });
const place = (overrides: Partial<AnchoredPlacementInput>) =>
  anchoredPlacement({ anchor: box(100, 200), viewport: VIEWPORT, contentHeight: 224, maxHeight: 224, width: 'anchor', rtl: false, ...overrides });

describe('anchoredPlacement: which side', () => {
  it('opens below the control when the content fits there', () => {
    const placement = place({});
    expect(placement.side).toBe('below');
    expect(placement.blockOffset).toBe(136 + LAYER_GAP);
    expect(placement.maxHeight).toBe(224);
  });

  it('flips above a control near the bottom of the viewport, growing up from its top', () => {
    const placement = place({ anchor: box(800, 200) });
    expect(placement.side).toBe('above');
    expect(placement.blockOffset).toBe(900 - 800 + LAYER_GAP);
    expect(placement.maxHeight).toBe(224);
  });

  it('stays below, clipped to the room there, when below has more room than above', () => {
    const placement = place({ anchor: box(200, 200), viewport: { width: 1280, height: 600 }, contentHeight: 900, maxHeight: 900 });
    expect(placement.side).toBe('below');
    expect(placement.maxHeight).toBe(600 - 236 - LAYER_GAP - LAYER_VIEWPORT_MARGIN);
  });

  it('caps the height above at the room above', () => {
    const placement = place({ anchor: box(150, 200, 300, 36), viewport: { width: 390, height: 220 }, width: 300 });
    expect(placement.side).toBe('above');
    expect(placement.maxHeight).toBe(150 - LAYER_GAP - LAYER_VIEWPORT_MARGIN);
  });

  it('a short list stays below even with little room above', () => {
    expect(place({ anchor: box(20, 200), contentHeight: 40 }).side).toBe('below');
  });
});

describe('anchoredPlacement: width and inline position', () => {
  it('is exactly the control wide and starts on its start edge (LTR)', () => {
    const placement = place({});
    expect(placement.width).toBe(300);
    expect(placement.insetInlineStart).toBe(200);
  });

  it('starts on the control\'s RIGHT edge in RTL (inset from the right of the viewport)', () => {
    const placement = place({ rtl: true });
    expect(placement.insetInlineStart).toBe(1280 - 500);
  });

  it('a fixed width is capped by the viewport and shifted back on screen', () => {
    const placement = place({ anchor: box(100, 200, 120), viewport: { width: 390, height: 844 }, width: 384 });
    expect(placement.width).toBe(390 - LAYER_VIEWPORT_MARGIN * 2);
    expect(placement.insetInlineStart).toBe(LAYER_VIEWPORT_MARGIN);
  });

  it('shifts a panel that would spill past the inline-end edge, in RTL too', () => {
    const anchor = box(100, 20, 120);
    const placement = place({ anchor, width: 300, rtl: true, viewport: { width: 390, height: 844 } });
    expect(placement.insetInlineStart).toBe(390 - 300 - LAYER_VIEWPORT_MARGIN);
    expect(placement.insetInlineStart + placement.width).toBeLessThanOrEqual(390 - LAYER_VIEWPORT_MARGIN);
  });
});
