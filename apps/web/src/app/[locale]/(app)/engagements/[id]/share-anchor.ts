// Server-safe DOM anchor id for the delivery share control. PLAIN module (NOT
// 'use client') so both the server page (which wraps the DeliveryShareLink) and
// the client detail component (whose "nudge client" scrolls to it) may import the
// same constant without turning it into a client-reference proxy.
export const DELIVERY_SHARE_ANCHOR_ID = 'delivery-share-link';

/**
 * Fired at the anchor element to ask the share control to OPEN.
 *
 * The control is a collapsed disclosure by default so the command card — the
 * thing the studio is actually here to act on — is not pushed down the page by a
 * side action. That makes scrolling to a closed box a worse answer than the old
 * always-open card, so the command card's "reveal the client link" both scrolls
 * AND opens. A DOM event rather than shared state: these two components sit on
 * either side of the server/client boundary and already share this module.
 */
export const DELIVERY_SHARE_OPEN_EVENT = 'metra:delivery-share-open';
