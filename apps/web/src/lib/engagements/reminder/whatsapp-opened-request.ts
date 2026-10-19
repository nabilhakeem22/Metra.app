// The browser half of "Open WhatsApp was clicked": one POST to its route, fired
// as the link opens. A plain fetch with `keepalive`, NOT a server action: the
// click navigates away (a new tab, or the WhatsApp app), and a fire-and-forget
// server action queued behind that never arrives on Workers. Client-safe.

export const WHATSAPP_OPENED_PATH = '/api/delivery-reminder/whatsapp-opened';

/** Record the click. Never throws; nobody waits for its answer. */
export function recordWhatsappOpened(engagementId: string): void {
  fetch(WHATSAPP_OPENED_PATH, {
    method: 'POST',
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ engagementId }),
  }).catch(() => undefined);
}
