import 'server-only';
import { headers } from 'next/headers';

/**
 * The public origin (`https://host`, no trailing slash) for a link we are about
 * to email or show — share links, invite links.
 * `NEXT_PUBLIC_APP_URL` wins when set, because behind Cloudflare the request
 * host can be the workers.dev origin while the canonical link must be the
 * custom domain. In PRODUCTION it is the ONLY accepted source: the Host header
 * is attacker-controlled, and a forged one turns every emailed share or invite
 * link into a link to the attacker's site, so an unset var (a deployment defect)
 * fails closed instead.
 * Returns null rather than throwing: the callers are server actions, where a
 * thrown error reaches the client as an unlocalizable digest while a null lets
 * them return a coded ActionResult.
 */
export async function resolveRequestOrigin(): Promise<string | null> {
  const override = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  if (override) return override;
  if (process.env.NODE_ENV === 'production') return null;

  const requestHeaders = await headers();
  // Each proxy APPENDS to these headers, so a value can be a list
  // (`a.example, b.example`). Take the leftmost NON-EMPTY entry: a hop that
  // appended nothing leaves an empty leading element that must not win. `||`,
  // not `??`: a present-but-empty header is absent, not an override.
  const firstPresentValue = (name: string) =>
    (requestHeaders.get(name) ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .find((entry) => entry !== '') ?? '';

  const host =
    firstPresentValue('x-forwarded-host') || firstPresentValue('host');
  if (!host) return null;

  const proto = firstPresentValue('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}
