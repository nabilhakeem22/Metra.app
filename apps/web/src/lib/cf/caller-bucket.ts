import 'server-only';

// The caller's rate-limit bucket by IP, shared by every pre-auth limiter (the
// Public API in lib/api/rate-limit.ts, sign-in in lib/auth/otp-throttle.ts).
// Cloudflare's cf-connecting-ip is the real caller and cannot be spoofed at the
// edge; x-forwarded-for is never read here, because the client writes it.

const IPV6_GROUPS = 8;
const HEXTET_RE = /^[0-9a-f]{1,4}$/;

/**
 * The eight hextets of an IPv6 address, lower-cased with leading zeros stripped.
 *
 * `::` stands for however many all-zero groups are missing, so it has to be
 * expanded before any two addresses can be compared: `2001:db8::1` and
 * `2001:0db8:0:0:0:0:0:2` share a /64 and neither spells it the same way.
 * Returns null for anything this cannot expand, including an embedded IPv4.
 */
function expandIpv6(address: string): string[] | null {
  const [head, tail, extra] = address.toLowerCase().split('::');
  if (extra !== undefined) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? 0 : IPV6_GROUPS - left.length - right.length;
  if (tail === undefined ? left.length !== IPV6_GROUPS : zeros < 1) return null;
  const groups = [...left, ...Array<string>(zeros).fill('0'), ...right];
  if (!groups.every((group) => HEXTET_RE.test(group))) return null;
  return groups.map((group) => group.replace(/^0+(?=.)/, ''));
}

/**
 * The /64 an IPv6 address sits in: its first four hextets, canonicalised.
 *
 * Canonical form is the whole point: keying on the text as sent let
 * `2001:db8::1` and `2001:db8::2` take separate buckets (they are one subscriber)
 * while `2001:0db8:...` and `2001:db8:...` took separate buckets for one address.
 * Anything unexpandable is keyed whole: a bucket of its own is the safe guess.
 */
function ipv6Prefix(address: string): string {
  const groups = expandIpv6(address);
  if (!groups) return address.toLowerCase();
  return groups.slice(0, 4).join(':');
}

/**
 * The caller rate-limit bucket: cf-connecting-ip (IPv6 keyed by its /64), or
 * null when the header is absent.
 *
 * An IPv6 caller is bucketed by its /64, not its address: the smallest block
 * routinely handed to a single subscriber is a /64, so keying on the full
 * address gives one holder 2^64 fresh budgets. IPv4 has no such spare room and
 * is keyed whole.
 */
export function callerIpBucket(headers: Headers): string | null {
  const ip = headers.get('cf-connecting-ip');
  if (!ip) return null;
  return ip.includes(':') ? ipv6Prefix(ip) : ip;
}
