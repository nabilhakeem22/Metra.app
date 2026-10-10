import 'server-only';
// A light per-share-link throttle for the client page's public acts and
// rendition routes (fix round S2). IN MEMORY, PER ISOLATE: each Worker isolate
// counts on its own, so the real ceiling is the limit times the isolates that
// happen to serve one link. It is a brake on a loop (a script, a stuck tab),
// not a quota; a Cloudflare rate-limit binding keyed on the hash is the
// stronger follow-up (docs, not this change). Keyed by the token's sha256, never
// the raw token; a blank token is not counted (the callers refuse it anyway).
import { hashShareToken } from './token';

export interface TokenThrottle {
  /** True when this link may act now; counts the attempt. */
  allow(rawToken: unknown, now?: number): boolean;
}

/** A fixed-window counter per link, holding at most `maxLinks` windows (oldest dropped). */
export function createTokenThrottle(limit: number, windowMs: number, maxLinks = 5_000): TokenThrottle {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    allow(rawToken, now = Date.now()) {
      const token = typeof rawToken === 'string' ? rawToken.trim() : '';
      if (!token) return true;
      const key = hashShareToken(token);
      const current = windows.get(key);
      if (!current || now - current.startedAt >= windowMs) {
        windows.delete(key);
        if (windows.size >= maxLinks) windows.delete(windows.keys().next().value!);
        windows.set(key, { startedAt: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
  };
}

/** Review acts (approve, request changes, acknowledge): 30 a minute per link. */
export const PORTAL_ACT_THROTTLE = createTokenThrottle(30, 60_000);

/** Pictures (thumbnails, previews, the logo): 300 a minute per link. */
export const PORTAL_RENDITION_THROTTLE = createTokenThrottle(300, 60_000);

/** The seconds a refused caller is told to wait. */
export const THROTTLE_RETRY_AFTER_SECONDS = 60;
