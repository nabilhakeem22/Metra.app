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
  const override = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (override) return override;

  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) return null;

  const proto = requestHeaders.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}
