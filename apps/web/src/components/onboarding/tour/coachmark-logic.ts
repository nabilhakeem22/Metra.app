// PURE coachmark helpers (no DOM), so the RTL positioning + keyboard mapping are
// unit-testable without a browser env.

/**
 * The logical inset-inline-start offset for the anchor: distance from the
 * INLINE-START viewport edge. In LTR that's the physical near edge; in RTL it
 * flips to be measured from the physical far edge, so `insetInlineStart`
 * positions correctly in both. `nearEdge`/`farEdge` = rect.left / rect.right.
 */
export function inlineStartOffset(
  nearEdge: number,
  farEdge: number,
  rtl: boolean,
  viewportWidth: number,
): number {
  return rtl ? viewportWidth - farEdge : nearEdge;
}

/**
 * Clamp a logical inset so a box of `boxSize` stays fully inside `viewportSize`
 * with `margin` on both edges. Operates in logical space (inset-inline-start),
 * so it is correct in LTR and RTL alike — the viewport width is direction-neutral.
 * When the box is wider than the space available it pins to the start margin
 * (the element's own max-width handles the overflow).
 */
export function clampInset(
  desiredInset: number,
  boxSize: number,
  viewportSize: number,
  margin: number,
): number {
  const max = Math.max(margin, viewportSize - boxSize - margin);
  return Math.min(Math.max(desiredInset, margin), max);
}

/**
 * Choose the block-axis top for the card: below the anchor by `gap`, unless
 * that would overflow the viewport bottom and there is more room above — then
 * flip above. Always clamped to stay within `[margin, viewportH - cardH - margin]`.
 */
export function cardTop(
  anchorTop: number,
  anchorBottom: number,
  cardHeight: number,
  viewportHeight: number,
  gap: number,
  margin: number,
): number {
  const below = anchorBottom + gap;
  const above = anchorTop - gap - cardHeight;
  const overflowsBelow = below + cardHeight + margin > viewportHeight;
  const chosen = overflowsBelow && above >= margin ? above : below;
  const max = Math.max(margin, viewportHeight - cardHeight - margin);
  return Math.min(Math.max(chosen, margin), max);
}

export type CoachKey = 'stop' | 'next' | 'prev' | 'tab' | null;

/** Map a keydown to a coachmark action. Esc=stop, →/Enter=next, ←=prev, Tab=trap. */
export function coachmarkKey(key: string): CoachKey {
  switch (key) {
    case 'Escape':
      return 'stop';
    case 'ArrowRight':
    case 'Enter':
      return 'next';
    case 'ArrowLeft':
      return 'prev';
    case 'Tab':
      return 'tab';
    default:
      return null;
  }
}

/** How far the highlight ring sits outside the anchor. */
export const ANCHOR_PADDING = 6;
/** Keep the card this far from every viewport edge. */
export const VIEWPORT_MARGIN = 16;
/** Space between the anchor and the card. */
export const ANCHOR_GAP = 10;

/**
 * A measured box in LOGICAL terms. `nearEdge`/`farEdge` rather than left/right
 * for the same reason `inlineStartOffset` takes them that way: this module is the
 * one place RTL is reasoned about, and naming a physical side here would be the
 * first step back to a card that mirrors wrong.
 */
export interface AnchorBox {
  top: number;
  bottom: number;
  nearEdge: number;
  farEdge: number;
  width: number;
  height: number;
}

export interface CoachmarkPlacement {
  /** The highlight ring's logical inset and box. */
  highlightInset: number;
  /** The card's logical inset and block-axis top. */
  cardInset: number;
  cardTop: number;
  /** The card's usable width once the viewport margins are taken out. */
  cardWidth: number;
}

/**
 * WHERE THE COACHMARK GOES, as a pure function of (anchor, card, viewport, rtl).
 *
 * Everything the card's position depends on is an argument, so RTL placement can
 * be checked without a browser — which matters because this is the one piece of
 * the tour no test can SEE: happy-dom has no layout, and a mirrored card that is
 * half off-screen looks fine in every assertion that is not about pixels.
 */
export function resolveCoachmarkPlacement(input: {
  anchor: AnchorBox;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  rtl: boolean;
}): CoachmarkPlacement {
  const { anchor, card, viewport, rtl } = input;
  // Logical inset — the distance from the INLINE-START edge (flips in RTL).
  const highlightInset = inlineStartOffset(
    anchor.nearEdge,
    anchor.farEdge,
    rtl,
    viewport.width,
  );
  // Viewport-aware card placement: clamp horizontally so the card can't run off
  // the inline-end edge (e.g. an anchor near the right edge), and flip above the
  // anchor when there's no room below.
  const cardWidth = Math.min(card.width, viewport.width - VIEWPORT_MARGIN * 2);
  return {
    highlightInset,
    cardWidth,
    cardInset: clampInset(highlightInset, cardWidth, viewport.width, VIEWPORT_MARGIN),
    cardTop: cardTop(
      anchor.top,
      anchor.bottom,
      card.height,
      viewport.height,
      ANCHOR_GAP,
      VIEWPORT_MARGIN,
    ),
  };
}
