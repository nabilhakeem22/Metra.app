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
import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import type { OrgContext } from '@/lib/db/context';
import { loadPdfOrg, MARGIN_HIDING_ORG, type PdfOrg } from '@/lib/pdf/org';
import { renderPdf, RendererBusyError } from '@/lib/pdf/render';
import { can, canSeeMargin } from '@/lib/permissions/can';
import type { Capability } from '@/lib/permissions/roles';

export type { PdfOrg };

export type PdfVariant = 'client' | 'internal';

/** The org row plus whatever else THIS document's header needs. */
export interface PdfHeader<THeader> {
  org: PdfOrg;
  header: THeader;
}

export interface PdfDocumentSpec<TDetail, THeader = undefined> {
  /** Read capability for this document family. */
  capability: Capability;
  /** Prefix for the two server-side error logs. Never contains client data. */
  logLabel: string;
  /** DOM size ceiling — refuse rather than time out mid-render. */
  maxLines: number;
  /**
   * OPTIONAL: this document's header read, in ONE transaction, carrying the org
   * row alongside whatever else the header needs (the BOQ's client and project
   * names) instead of paying for a second transaction to fetch it. It must NOT
   * fetch cost — it runs BEFORE the margin gate. `null` = a 404.
   */
  loadHeader?(ctx: OrgContext, id: string): Promise<PdfHeader<THeader> | null>;
  /** `showCost` is false for the client copy, which must never FETCH cost. */
  load(
    ctx: OrgContext,
    id: string,
    showCost: boolean,
    header: THeader,
  ): Promise<TDetail | null>;
  lineCount(detail: TDetail): number;
  buildHtml(
    detail: TDetail,
    context: {
      locale: string;
      variant: PdfVariant;
      org: PdfOrg;
      header: THeader;
    },
  ): Promise<string>;
  fileName(detail: TDetail, variant: PdfVariant): string;
}

/** Client is the default; only `?variant=internal` opts into the cost copy. */
function resolveVariant(req: Request): PdfVariant {
  return new URL(req.url).searchParams.get('variant') === 'internal'
    ? 'internal'
    : 'client';
}

/** The spec's own header read, or the plain org read every document falls back to. */
async function loadHeaderFor<TDetail, THeader>(
  ctx: OrgContext,
  id: string,
  spec: PdfDocumentSpec<TDetail, THeader>,
): Promise<PdfHeader<THeader> | null> {
  if (spec.loadHeader) return spec.loadHeader(ctx, id);
  // No loadHeader means the spec named no header type, so `undefined` IS its
  // THeader: the org row on its own, which is what two of the three routes need.
  return { org: await loadPdfOrg(ctx), header: undefined as THeader };
}

const json = (error: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers });

/** Serve one document as a PDF, in the one order all three routes must follow. */
export async function servePdfDocument<TDetail, THeader = undefined>(
  req: Request,
  id: string,
  spec: PdfDocumentSpec<TDetail, THeader>,
): Promise<Response> {
  const variant = resolveVariant(req);

  if (!(await getSessionUser())) return json('Unauthorized', 401);
  const ctx = await requireOrg();
  if (!can(ctx.role, spec.capability, 'read')) return json('Forbidden', 403);

  const loaded = await loadHeaderFor(ctx, id, spec);
  // Margin-gated BEFORE the load, so a blind role never even fetches cost — and
  // gated margin-HIDING when the header did not resolve, so the 403 cannot be
  // skipped by naming an id that does not exist.
  const org = loaded?.org ?? MARGIN_HIDING_ORG;
  if (variant === 'internal' && !canSeeMargin(ctx.role, org.hideMarginFromPm)) {
    return json('Forbidden', 403);
  }
  if (!loaded) return json('Not found', 404);

  const detail = await spec.load(ctx, id, variant === 'internal', loaded.header);
  if (!detail) return json('Not found', 404);
  // Refuse a DOM the renderer cannot finish inside maxDuration.
  if (spec.lineCount(detail) > spec.maxLines) return json('Too large to render', 413);

  return renderDocument(spec, detail, variant, { org, header: loaded.header });
}

/** Build the DOM, render it, and turn a renderer failure into its own status. */
async function renderDocument<TDetail, THeader>(
  spec: PdfDocumentSpec<TDetail, THeader>,
  detail: TDetail,
  variant: PdfVariant,
  { org, header }: PdfHeader<THeader>,
): Promise<Response> {
  try {
    const html = await spec.buildHtml(detail, {
      locale: org.defaultLocale,
      variant,
      org,
      header,
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
