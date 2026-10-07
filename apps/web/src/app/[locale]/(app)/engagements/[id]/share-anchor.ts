// Server-safe names of the "open the client link" and "open the reminder"
// events. A PLAIN module (NOT 'use client'), so the dispatchers below and the
// dialogs that listen for them import the same constants without turning them
// into client-reference proxies.

/**
 * Fired on `window` to ask the client-link dialog to OPEN, from the header's
 * menu. A window event rather than shared state: the opener and the dialog are
 * siblings several components apart.
 */
export const DELIVERY_SHARE_OPEN_EVENT = 'metra:delivery-share-open';

/**
 * Open the client-link dialog. No server action.
 *
 * It lives beside the event it dispatches rather than in the component that
 * calls it: the function that fires an event and the name of that event are one
 * fact, and separating them is how a listener ends up subscribed to a string
 * nobody dispatches any more.
 */
export function revealDeliveryShareLink(): void {
  window.dispatchEvent(new CustomEvent(DELIVERY_SHARE_OPEN_EVENT));
}

/**
 * Fired on `window` to ask the "Send reminder" dialog to OPEN (Round B, B11).
 * The header menu, the waiting card's primary and the checklist's nudge pill
 * all open it; the dialog hangs off the header, like the client-link dialog.
 */
export const DELIVERY_REMINDER_OPEN_EVENT = 'metra:delivery-reminder-open';

/** Nudge = open the reminder dialog, which carries the link the client already holds. */
export function openDeliveryReminder(): void {
  window.dispatchEvent(new CustomEvent(DELIVERY_REMINDER_OPEN_EVENT));
}

/**
 * Fired on `window` after THIS page minted, replaced or revoked the client link
 * (either dialog). The other dialog drops what it was showing: a link it
 * revealed may be dead, a reminder it prepared may carry the old link.
 */
export const DELIVERY_LINK_CHANGED_EVENT = 'metra:delivery-link-changed';

export interface DeliveryLinkChange {
  /** Is there a live client link after the change? */
  shared: boolean;
  /** Which dialog changed it: each ignores its own announcement. */
  source: 'clientLink' | 'reminder';
}

export function announceDeliveryLinkChanged(change: DeliveryLinkChange): void {
  window.dispatchEvent(new CustomEvent<DeliveryLinkChange>(DELIVERY_LINK_CHANGED_EVENT, { detail: change }));
}
