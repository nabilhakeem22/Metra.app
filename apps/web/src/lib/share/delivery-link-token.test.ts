import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { mintDeliveryLinkToken, rederiveDeliveryLinkToken } from './delivery-link-token';
import { hashShareToken } from './token';

// The re-derivable delivery link (B11). A security primitive: the raw token IS
// the client's authentication, so re-deriving must never hand back a link
// other than the one the row's hash names.

const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';
const OTHER_ENGAGEMENT = '22222222-2222-4222-8222-222222222222';
const SECRET = 'a'.repeat(48);

beforeEach(() => {
  process.env.SHARE_LINK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SHARE_LINK_SECRET;
});

describe('mintDeliveryLinkToken', () => {
  it('mints a re-derivable link: url-safe raw, its hash, a 128-bit nonce', () => {
    const minted = mintDeliveryLinkToken(ENGAGEMENT);
    expect(minted.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(minted.hash).toBe(hashShareToken(minted.raw));
    expect(Buffer.from(minted.nonce!, 'base64url')).toHaveLength(16);
  });

  it('never repeats', () => {
    const raws = new Set(Array.from({ length: 100 }, () => mintDeliveryLinkToken(ENGAGEMENT).raw));
    expect(raws.size).toBe(100);
  });

  it.each([undefined, '', 'short-secret'])(
    'without a usable secret (%j): a plain random token and no nonce',
    (secret) => {
      if (secret === undefined) delete process.env.SHARE_LINK_SECRET;
      else process.env.SHARE_LINK_SECRET = secret;
      const minted = mintDeliveryLinkToken(ENGAGEMENT);
      expect(minted.nonce).toBeNull();
      expect(Buffer.from(minted.raw, 'base64url')).toHaveLength(32);
      expect(minted.hash).toBe(hashShareToken(minted.raw));
    },
  );
});

describe('rederiveDeliveryLinkToken', () => {
  it('round-trips: re-deriving a minted link returns its raw token', () => {
    const minted = mintDeliveryLinkToken(ENGAGEMENT);
    expect(rederiveDeliveryLinkToken(ENGAGEMENT, minted.nonce, minted.hash)).toBe(minted.raw);
  });

  it('a different secret re-derives nothing', () => {
    const minted = mintDeliveryLinkToken(ENGAGEMENT);
    process.env.SHARE_LINK_SECRET = 'b'.repeat(48);
    expect(rederiveDeliveryLinkToken(ENGAGEMENT, minted.nonce, minted.hash)).toBeNull();
  });

  it('a missing secret re-derives nothing', () => {
    const minted = mintDeliveryLinkToken(ENGAGEMENT);
    delete process.env.SHARE_LINK_SECRET;
    expect(rederiveDeliveryLinkToken(ENGAGEMENT, minted.nonce, minted.hash)).toBeNull();
  });

  it('a stale nonce next to a newer hash re-derives nothing (rotated by older code)', () => {
    const old = mintDeliveryLinkToken(ENGAGEMENT);
    const rotated = mintDeliveryLinkToken(ENGAGEMENT);
    expect(rederiveDeliveryLinkToken(ENGAGEMENT, old.nonce, rotated.hash)).toBeNull();
  });

  it("another delivery's id with the right nonce re-derives nothing", () => {
    const minted = mintDeliveryLinkToken(ENGAGEMENT);
    expect(rederiveDeliveryLinkToken(OTHER_ENGAGEMENT, minted.nonce, minted.hash)).toBeNull();
  });

  it('no nonce (a pre-Round-B link) or no stored hash (revoked) re-derives nothing', () => {
    const minted = mintDeliveryLinkToken(ENGAGEMENT);
    expect(rederiveDeliveryLinkToken(ENGAGEMENT, null, minted.hash)).toBeNull();
    expect(rederiveDeliveryLinkToken(ENGAGEMENT, minted.nonce, null)).toBeNull();
  });
});

describe('a deployment without a usable secret (F9)', () => {
  it('says so once per isolate, by name, never the value', async () => {
    vi.resetModules();
    process.env.SHARE_LINK_SECRET = 'short-but-secret-value';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fresh = await import('./delivery-link-token');
    expect(fresh.deliveryLinkSecretConfigured()).toBe(false);
    fresh.mintDeliveryLinkToken(ENGAGEMENT);
    fresh.rederiveDeliveryLinkToken(ENGAGEMENT, 'nonce', 'hash');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('SHARE_LINK_SECRET');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('short-but-secret-value');
    warn.mockRestore();
  });

  it('a usable secret is "configured" and warns nothing', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fresh = await import('./delivery-link-token');
    expect(fresh.deliveryLinkSecretConfigured()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
