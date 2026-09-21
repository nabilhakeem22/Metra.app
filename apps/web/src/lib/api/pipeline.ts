import 'server-only';
import { organizations } from '@metra/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { isCloudflareRuntime, cfExecutionContext } from '@/lib/cf/context';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { canSeeMargin } from '@/lib/permissions/can';
import { touchApiKey, API_KEY_PREFIX, type ApiPrincipal } from '@/lib/api-keys/resolve';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { admitApiCaller, bearerToken, type AdmissionOptions } from './admit';
import { problemResponse } from './errors';
import { InvalidCursorError } from './pagination';

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

/** What a route declares. Admission owns the shape: it is what reads every field. */
export type PipelineOptions = AdmissionOptions;

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
  // Through sqlstateOf: the cast is performed by a query the ORM ran, so from
  // drizzle 0.44 the SQLSTATE arrives on `.cause` and a top-level read would
  // answer a malformed cursor with a 500 instead of the documented 400.
  const code = sqlstateOf(error);
  return code !== undefined && CURSOR_CAST_SQLSTATES.has(code);
}

/** Best-effort, throttled last_used stamp — deferred past the response (CF only). */
function deferUsageStamp(raw: string | null): void {
  if (!raw || !raw.startsWith(API_KEY_PREFIX) || !isCloudflareRuntime()) return;
  cfExecutionContext().waitUntil(
    touchApiKey(raw).catch(() => {
      /* best-effort — never fail a request on the usage stamp */
    }),
  );
}

/** The RFC 7807 catch-all: NotFound -> 404, a bad cursor -> 400, else 500. */
function problemForThrown(error: unknown): Response {
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
  console.error('Public API request failed:', loggableFailure(error));
  return problemResponse('internal');
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
  // --- admission: budgets, key, capability (no row is read until it passes) -
  const admitted = await admitApiCaller(req, options);
  if (admitted instanceof Response) return admitted;
  const principal = admitted;
  const raw = bearerToken(req);

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

    deferUsageStamp(raw);
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return problemForThrown(error);
  }
}
