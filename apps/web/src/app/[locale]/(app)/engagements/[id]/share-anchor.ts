// Server-safe DOM anchor id for the delivery share control. PLAIN module (NOT
// 'use client') so both the server page (which wraps the DeliveryShareLink) and
// the client detail component (whose "nudge client" scrolls to it) may import the
// same constant without turning it into a client-reference proxy.
export const DELIVERY_SHARE_ANCHOR_ID = 'delivery-share-link';
