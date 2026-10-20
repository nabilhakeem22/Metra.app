import 'server-only';
import { headers } from 'next/headers';

/**
 * Who sent a session-less portal write, for the append-only audit trail: the
 * client IP (capped at 45 chars) and user agent (capped at 512). The IP prefers
 * the platform-trusted edge header `cf-connecting-ip` (set by Cloudflare, not
 * client-spoofable) and falls back to the FIRST `x-forwarded-for` hop only when
 * the edge header is absent. Advisory provenance only, never an authorization
 * input. The write functions cap both again: they are the trust boundary.
 */
export async function requestProvenance(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const edge = h.get('cf-connecting-ip')?.trim();
  const ip = edge
    ? edge.slice(0, 45)
    : h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) || null;
  return { ip, userAgent: h.get('user-agent')?.slice(0, 512) || null };
}
