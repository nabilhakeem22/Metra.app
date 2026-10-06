// Server-safe name of the "open the client link" event. A PLAIN module (NOT
// 'use client'), so the dispatcher below and the dialog that listens for it
// import the same constant without turning it into a client-reference proxy.

/**
 * Fired on `window` to ask the client-link dialog to OPEN. The checklist's
 * "nudge client" pill and the waiting card's re-share button sit in the command
 * card; the dialog hangs off the header's menu. A window event rather than
 * shared state: the two are siblings several components apart.
 */
export const DELIVERY_SHARE_OPEN_EVENT = 'metra:delivery-share-open';

/**
 * Nudge = open the client-link dialog. No server action, no notify.
 *
 * It lives beside the event it dispatches rather than in the component that
 * calls it: the function that fires an event and the name of that event are one
 * fact, and separating them is how a listener ends up subscribed to a string
 * nobody dispatches any more.
 */
export function revealDeliveryShareLink(): void {
  window.dispatchEvent(new CustomEvent(DELIVERY_SHARE_OPEN_EVENT));
}
