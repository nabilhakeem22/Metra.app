import 'server-only';
import { headers } from 'next/headers';

/**
 * The public origin (`https://host`, no trailing slash) to embed in a link we
 * are about to email or show — share links, invite links.
 *
 * `NEXT_PUBLIC_APP_URL` wins when set, because behind Cloudflare the request
 * host can be the workers.dev origin while the canonical link must be the
 * custom domain. Otherwise it is derived from the forwarded request headers.
 *
 * Returns null instead of throwing when there is no host at all: the callers
 * are server actions, and a thrown error reaches the client as an unlocalizable
 * digest. A null lets them return a coded ActionResult.
 */
export async function resolveRequestOrigin(): Promise<string | null> {
  const override = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  if (override) return override;

  const requestHeaders = await headers();
  // Each proxy in a chain APPENDS to these headers, so the value can be a list
  // (`a.example, b.example`). Take the leftmost NON-EMPTY entry: that is the
  // host/scheme the client actually asked for, and a hop that appended nothing
  // leaves an empty leading element (`, real.example`) that must not win.
  const firstPresentValue = (name: string) =>
    (requestHeaders.get(name) ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .find((entry) => entry !== '') ?? '';

  // `||`, not `??`: a present-but-empty header is absent, not an override. With
  // `??` an empty `x-forwarded-host` shadowed a valid `host`, and an empty
  // `x-forwarded-proto` produced the unusable `://host`.
  const host =
    firstPresentValue('x-forwarded-host') || firstPresentValue('host');
  if (!host) return null;

  const proto = firstPresentValue('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}
