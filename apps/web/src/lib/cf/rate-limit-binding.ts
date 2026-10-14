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
    // developer-only: a binding name and a surface label, both constants.
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
 * How long a request waits for the limiter before it goes ahead unmetered. The
 * binding is a local counter (no network wait), so a healthy call answers in
 * a few milliseconds; past this it is a stalled limiter, and a stalled limiter
 * must not stall every act and read behind it.
 */
export const RATE_LIMIT_DEADLINE_MS = 250;

const TIMED_OUT = Symbol('rate limiter timed out');

/** The limiter's answer, or TIMED_OUT once the deadline passes. The timer is always cleared. */
async function answerWithin(limiter: CloudflareRateLimit, key: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), RATE_LIMIT_DEADLINE_MS);
  });
  try {
    return await Promise.race([limiter.limit({ key }), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Charges one request to `key`'s bucket in `bindingName`: true when it may proceed.
 *
 * OWNER DECISION, recorded so it is not silently reversed by whoever next reads
 * this and thinks it looks like a bug. The failures are DIFFERENT and are
 * handled differently ON PURPOSE:
 *
 *  - A binding ERROR fails OPEN. An availability blip in Cloudflare's limiter
 *    would otherwise take the whole surface down for every caller, and a few
 *    seconds of unmetered traffic is a smaller harm than a total outage. So do
 *    a limiter that has not answered by RATE_LIMIT_DEADLINE_MS and an answer
 *    that is not `{ success: boolean }`. Each is logged with the binding name
 *    (never the key), so it is visible rather than merely survived.
 *  - A MISSING binding fails CLOSED, and never reaches this function at all:
 *    `rateLimitBinding()` throws and the request is refused. That is not an
 *    availability problem, it is a misdeployed Worker.
 *
 * The same sentence is in docs/API.md, for the reader who is looking at the
 * behaviour rather than at the code.
 */
export async function consumeRateLimit(
  limiter: CloudflareRateLimit | null,
  key: string,
  bindingName: string,
): Promise<boolean> {
  if (!limiter) return true;
  try {
    const answer = await answerWithin(limiter, key);
    if (answer === TIMED_OUT) {
      console.error('rate limiter timeout (failing open):', { binding: bindingName, deadlineMs: RATE_LIMIT_DEADLINE_MS });
      return true;
    }
    const success = (answer as { success?: unknown } | null | undefined)?.success;
    if (typeof success !== 'boolean') {
      console.error('rate limiter malformed answer (failing open):', { binding: bindingName });
      return true;
    }
    return success === true;
  } catch (error) {
    console.error('rate limiter error (failing open):', { binding: bindingName, ...redactedFailure(error, key) });
    return true;
  }
}
