import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordWhatsappOpened, WHATSAPP_OPENED_PATH } from './whatsapp-opened-request';

// The click record must outlive the navigation it rides on: a keepalive POST,
// same-origin, and never a thrown error in the click handler.
afterEach(() => vi.unstubAllGlobals());

describe('recordWhatsappOpened', () => {
  it('posts the delivery id with keepalive and swallows a failure', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchMock);
    expect(() => recordWhatsappOpened('e-1')).not.toThrow();
    expect(fetchMock).toHaveBeenCalledWith(WHATSAPP_OPENED_PATH, expect.objectContaining({
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      body: JSON.stringify({ engagementId: 'e-1' }),
    }));
    await Promise.resolve();
  });
});
