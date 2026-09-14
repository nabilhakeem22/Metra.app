import 'server-only';
// The ONE PDF route body. Three routes ran the same twelve steps in the same
// order — parse the variant, 401, 403, look up the org, margin-gate the internal
// copy, 404, 413, build, render, 200 with no-store, 503 on a busy renderer, 500
// — and each carried its own copy of that order.
//
// The order is not incidental. The margin gate must come BEFORE the document is
// loaded with cost, the 413 must come before the renderer is asked to open a DOM
// it cannot finish inside maxDuration, and `cache-control: no-store` must be on
// every response, because the internal copy carries the firm's margin and must
// not be readable back off a shared machine's disk. A route that reordered two
// of those would still look right and still compile.
import { organizations } from '@metra/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { renderPdf, RendererBusyError } from '@/lib/pdf/render';
import { can, canSeeMargin } from '@/lib/permissions/can';
import type { Capability } from '@/lib/permissions/roles';

export type PdfVariant = 'client' | 'internal';

/** The org fields every document header needs. */
export interface PdfOrg {
  nameAr: string | null;
  nameEn: string | null;
  defaultLocale: string;
  hideMarginFromPm: boolean;
}

export interface PdfDocumentSpec<TDetail> {
  /** Read capability for this document family. */
  capability: Capability;
  /** Prefix for the two server-side error logs. Never contains client data. */
  logLabel: string;
  /** DOM size ceiling — refuse rather than time out mid-render. */
  maxLines: number;
  /** `showCost` is false for the client copy, which must never FETCH cost. */
  load(ctx: OrgContext, id: string, showCost: boolean): Promise<TDetail | null>;
  lineCount(detail: TDetail): number;
  buildHtml(
    detail: TDetail,
    context: { locale: string; variant: PdfVariant; org: PdfOrg },
  ): Promise<string>;
  fileName(detail: TDetail, variant: PdfVariant): string;
}

/** Client is the default; only `?variant=internal` opts into the cost copy. */
function resolveVariant(req: Request): PdfVariant {
  return new URL(req.url).searchParams.get('variant') === 'internal'
    ? 'internal'
    : 'client';
}

/**
 * The caller's own org row. Explicitly `where id = ctx.orgId` rather than
 * `limit 1` inside the RLS transaction: the policy already scopes it, but a bare
 * `limit 1` is a query whose correctness depends entirely on something a reader
 * cannot see here, and it would silently pick an arbitrary row if the policy
 * ever widened. Falls back to a margin-HIDING default, so a missing row loses
 * branding rather than leaking cost.
 */
async function loadPdfOrg(ctx: OrgContext): Promise<PdfOrg> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        nameAr: organizations.nameAr,
        nameEn: organizations.nameEn,
        defaultLocale: organizations.defaultLocale,
        hideMarginFromPm: organizations.hideMarginFromPm,
      })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1),
  );
  return (
    row ?? { nameAr: null, nameEn: null, defaultLocale: 'ar-EG', hideMarginFromPm: true }
  );
}

const json = (error: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers });

/** Serve one document as a PDF, in the one order all three routes must follow. */
export async function servePdfDocument<TDetail>(
  req: Request,
  id: string,
  spec: PdfDocumentSpec<TDetail>,
): Promise<Response> {
  const variant = resolveVariant(req);

  if (!(await getSessionUser())) return json('Unauthorized', 401);
  const ctx = await requireOrg();
  if (!can(ctx.role, spec.capability, 'read')) return json('Forbidden', 403);

  const org = await loadPdfOrg(ctx);
  // Margin-gated BEFORE the load, so a blind role never even fetches cost.
  if (variant === 'internal' && !canSeeMargin(ctx.role, org.hideMarginFromPm)) {
    return json('Forbidden', 403);
  }

  const detail = await spec.load(ctx, id, variant === 'internal');
  if (!detail) return json('Not found', 404);
  // Refuse a DOM the renderer cannot finish inside maxDuration.
  if (spec.lineCount(detail) > spec.maxLines) return json('Too large to render', 413);

  try {
    const html = await spec.buildHtml(detail, {
      locale: org.defaultLocale,
      variant,
      org,
    });
    return pdfResponse(await renderPdf(html), spec.fileName(detail, variant));
  } catch (cause) {
    return renderFailure(cause, spec.logLabel);
  }
}

function pdfResponse(pdf: Uint8Array, fileName: string): Response {
  return new NextResponse(pdf as BodyInit, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${fileName}"`,
      // The internal copy carries the firm's margin: never cached, not even
      // privately, so it cannot be read back off a shared machine's disk.
      'cache-control': 'no-store',
    },
  });
}

function renderFailure(cause: unknown, logLabel: string): Response {
  if (cause instanceof RendererBusyError) {
    // The renderer is at its concurrency cap after retries. A retryable 503 with
    // retry-after, not a 500 — the caller should back off, not give up.
    console.error(`${logLabel} PDF renderer busy:`, cause);
    return json('Renderer busy, try again', 503, { 'retry-after': '5' });
  }
  console.error(`${logLabel} PDF render failed:`, cause);
  return json('PDF generation failed', 500);
}
