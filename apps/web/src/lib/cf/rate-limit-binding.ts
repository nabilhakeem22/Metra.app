import 'server-only';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { cfEnv, isCloudflareRuntime } from '@/lib/cf/context';

// The Cloudflare Workers Rate Limiting binding, shared by every limited surface
// (the Public API in lib/api/rate-limit.ts, the client portal in
// lib/share/portal-rate-limit.ts). A binding counts PER DATA CENTRE, not
// globally: a caller spread across k colos gets k x the configured ceiling.

/** The Cloudflare Rate Limiting binding shape (the subset used here). */
export interface CloudflareRateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The named binding, or null OFF-platform (Node, Vitest, `next dev`), where the
 * bindings are legitimately absent and nothing is limited. On Cloudflare a
 * missing binding is a deployment defect, not a degraded mode: returning null
 * there would serve `surface` with no limit at all, so it throws instead.
 */
export function rateLimitBinding(name: string, surface: string): CloudflareRateLimit | null {
  if (!isCloudflareRuntime()) return null;
  const env = cfEnv() as unknown as Record<string, CloudflareRateLimit | undefined>;
  const limiter = env[name];
  if (!limiter) {
    throw new Error(
      `Rate limiting binding ${name} is missing on the Cloudflare runtime. ` +
        `Add it to apps/web/wrangler.jsonc. Refusing to serve ${surface} unlimited.`,
    );
  }
  return limiter;
}

/** The safe-to-log view of a limiter failure, with the bucket key cut out of every field. */
function redactedFailure(error: unknown, key: string): Record<string, string> {
  const fields = loggableFailure(error);
  if (!key) return fields;
  for (const [field, value] of Object.entries(fields)) fields[field] = value.split(key).join('[key]');
  return fields;
}

/**
 * Charges one request to `key`'s bucket: true when it may proceed.
 *
 * OWNER DECISION, recorded so it is not silently reversed by whoever next reads
 * this and thinks it looks like a bug. The two failures are DIFFERENT and are
 * handled differently ON PURPOSE:
 *
 *  - A binding ERROR fails OPEN. An availability blip in Cloudflare's limiter
 *    would otherwise take the whole surface down for every caller, and a few
 *    seconds of unmetered traffic is a smaller harm than a total outage. The
 *    blip is logged (never the key), so it is visible rather than merely survived.
 *  - A MISSING binding fails CLOSED, and never reaches this function at all:
 *    `rateLimitBinding()` throws and the request is refused. That is not an
 *    availability problem, it is a misdeployed Worker.
 *
 * The same sentence is in docs/API.md, for the reader who is looking at the
 * behaviour rather than at the code.
 */
export async function consumeRateLimit(limiter: CloudflareRateLimit | null, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (error) {
    console.error('rate limiter error (failing open):', redactedFailure(error, key));
    return true;
  }
}
