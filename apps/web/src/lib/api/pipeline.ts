import 'server-only';
import { organizations } from '@metra/db';
import { isCloudflareRuntime, cfExecutionContext } from '@/lib/cf/context';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can, canSeeMargin } from '@/lib/permissions/can';
import type { Capability, PermissionAction } from '@/lib/permissions/roles';
import {
  resolveApiKey,
  touchApiKey,
  API_KEY_PREFIX,
  type ApiPrincipal,
} from '@/lib/api-keys/resolve';
import { problemResponse } from './errors';
import { InvalidCursorError } from './pagination';
import {
  cloudflarePreAuthRateLimiter,
  cloudflareRateLimiter,
  RATE_LIMIT_WINDOW_SECONDS,
  type PreAuthRateLimiter,
  type RateLimiter,
  type RateLimitResult,
} from './rate-limit';

/** Thrown by a handler when a requested resource is absent/foreign. -> 404. */
export class NotFoundError extends Error {
  constructor() {
    super('not found');
    this.name = 'NotFoundError';
  }
}

/** Everything a v1 handler needs; all data access must use `ctx`. */
export interface ApiContext {
  principal: ApiPrincipal;
  /** canSeeMargin(role, org.hideMarginFromPm) — computed once per request. */
  costVisible: boolean;
  ctx: OrgContext;
  url: URL;
}

/** A handler returns a JSON-serializable value (200) or throws NotFound/Invalid. */
export type ApiHandler = (c: ApiContext) => Promise<unknown>;

export interface PipelineOptions {
  /**
   * The §2.2 capability this route reads, and the action to check it with.
   * REQUIRED and deliberately not defaulted: a route that forgets to declare
   * one is a route with no authorization, so it must not compile.
   */
  capability: Capability;
  action: PermissionAction;
  /** Injectable for tests; default to the Cloudflare Rate Limiting bindings. */
  rateLimiter?: RateLimiter;
  preAuthRateLimiter?: PreAuthRateLimiter;
}

/** 429 + Retry-After, built identically for both buckets. */
function rateLimitedResponse(rate: RateLimitResult): Response {
  return problemResponse('rate-limited', {
    detail: 'API rate limit exceeded.',
    headers: {
      'retry-after': String(rate.retryAfterSeconds || RATE_LIMIT_WINDOW_SECONDS),
    },
  });
}

// Belt-and-suspenders (F2): the only user-supplied timestamp/uuid that reaches a
// ::timestamptz / ::uuid cast is the pagination cursor (detail routes pre-validate
// their id, and decodeCursor already strictly validates format). So a residual PG
// datetime/uuid cast error in the request path means a bad cursor -> 400, never 500.
const CURSOR_CAST_SQLSTATES = new Set([
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
  '22P02', // invalid_text_representation (bad uuid/timestamp literal)
]);

function isCursorCastError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CURSOR_CAST_SQLSTATES.has(code);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * The Public API (v1) request pipeline:
 *   pre-auth rate-limit (per caller; 429 BEFORE the key lookup touches the DB)
 *   -> auth (Bearer mtk_… -> resolve; 401 on any failure)
 *   -> per-key rate-limit (429 + Retry-After; no DB/handler work)
 *   -> authorize (can(role, capability, action); 403 BEFORE any org read)
 *   -> derive costVisible (canSeeMargin, live-role)
 *   -> handler (all reads inside withOrgContext -> RLS + membership factor)
 *   -> serialize (application/json)
 *   -> RFC 7807 catch-all (NotFound=404, InvalidCursor=400, else 500).
 * last_used_at is stamped best-effort, deferred past the response (CF only).
 *
 * The capability check is the reason `options` is required: v1 previously let
 * ANY valid key read ANY route, so a viewer-scoped or client-scoped key reached
 * the price book. `can()` runs before the organization row is read, so a refused
 * role costs no database work either.
 */
export async function handleApiRequest(
  req: Request,
  handler: ApiHandler,
  options: PipelineOptions,
): Promise<Response> {
  // --- pre-auth rate limit (BEFORE the key lookup hits the database) -------
  const preAuth = await (options.preAuthRateLimiter ?? cloudflarePreAuthRateLimiter)(
    req,
  );
  if (!preAuth.allowed) return rateLimitedResponse(preAuth);

  const raw = bearerToken(req);

  // --- auth ---------------------------------------------------------------
  const principal = await resolveApiKey(raw);
  if (!principal) {
    return problemResponse('unauthorized', {
      detail: 'A valid Bearer API key is required.',
    });
  }

  // --- per-key rate limit (BEFORE any data/handler work) ------------------
  const limiter = options.rateLimiter ?? cloudflareRateLimiter;
  const rate = await limiter(principal.keyId);
  if (!rate.allowed) return rateLimitedResponse(rate);

  // --- authorize (BEFORE any org read) ------------------------------------
  if (!can(principal.role, options.capability, options.action)) {
    return problemResponse('forbidden', {
      detail: 'The role behind this API key may not read this resource.',
    });
  }

  // --- derive live cost/margin visibility ---------------------------------
  const orgCtx = principal.toOrgContext();
  try {
    const [org] = await withOrgContext(orgCtx, (tx) =>
      tx
        .select({ hide: organizations.hideMarginFromPm })
        .from(organizations)
        .limit(1),
    );
    const costVisible = canSeeMargin(principal.role, org?.hide ?? true);

    // --- handler + serialize ---------------------------------------------
    const value = await handler({
      principal,
      costVisible,
      ctx: orgCtx,
      url: new URL(req.url),
    });

    // Best-effort, throttled last_used stamp — deferred past the response (CF).
    if (raw && raw.startsWith(API_KEY_PREFIX) && isCloudflareRuntime()) {
      cfExecutionContext().waitUntil(
        touchApiKey(raw).catch(() => {
          /* best-effort — never fail a request on the usage stamp */
        }),
      );
    }

    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return problemResponse('not-found', {
        detail: 'The requested resource does not exist.',
      });
    }
    if (error instanceof InvalidCursorError || isCursorCastError(error)) {
      return problemResponse('invalid-cursor', {
        detail: 'The provided cursor is malformed.',
      });
    }
    console.error('Public API request failed:', error);
    return problemResponse('internal');
  }
}
