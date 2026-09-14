import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SHARE_TTL_DAYS, hashShareToken, mintShareToken, shareExpiryFromNow } from './token';

// This is a security primitive: the token IS the auth on every public surface.
// The properties below are the ones a future edit must not be able to break
// quietly — entropy, url-safety, hash-not-secret, and the trim.

describe('mintShareToken', () => {
  it('returns 256 bits of entropy in a url-safe alphabet', () => {
    const { raw } = mintShareToken();
    expect(Buffer.from(raw, 'base64url')).toHaveLength(32);
    // base64url only: no '+', '/' or '=' to be mangled by a mail client.
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', () => {
    const minted = new Set(Array.from({ length: 200 }, () => mintShareToken().raw));
    expect(minted.size).toBe(200);
  });

  it('hashes what it returns, and the hash is not the secret', () => {
    const { raw, hash } = mintShareToken();
    expect(hash).toBe(hashShareToken(raw));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(raw);
  });
});

describe('hashShareToken', () => {
  it('is sha256 over the token — the same digest the SDFs look up', () => {
    expect(hashShareToken('abc')).toBe(
      createHash('sha256').update('abc').digest('hex'),
    );
  });

  it('TRIMS, so a token copied out of an email still resolves', () => {
    // A link pasted out of WhatsApp or a mail client readily carries a trailing
    // space or newline. Every call site used to hand-write .trim(); one that
    // forgot turned a valid link into token_invalid with no way to tell why.
    const expected = hashShareToken('abc');
    for (const raw of [' abc', 'abc ', '  abc\n', '\tabc\r\n']) {
      expect(hashShareToken(raw)).toBe(expected);
    }
  });

  it('does not collapse whitespace INSIDE a token', () => {
    expect(hashShareToken('a bc')).not.toBe(hashShareToken('abc'));
  });
});

describe('shareExpiryFromNow', () => {
  it('defaults to the share TTL', () => {
    expect(SHARE_TTL_DAYS).toBe(30);
    const before = Date.now();
    const expiry = shareExpiryFromNow().getTime();
    const after = Date.now();
    expect(expiry).toBeGreaterThanOrEqual(before + 30 * 86_400_000);
    expect(expiry).toBeLessThanOrEqual(after + 30 * 86_400_000);
  });

  it('honours an explicit horizon — the invite token has its own', () => {
    const expiry = shareExpiryFromNow(7).getTime();
    expect(expiry - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(expiry - Date.now()).toBeLessThan(7.1 * 86_400_000);
  });
});
