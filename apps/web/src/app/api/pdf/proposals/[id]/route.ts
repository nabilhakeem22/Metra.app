import { organizations } from '@metra/db';
import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withOrgContext } from '@/lib/db/context';
import { renderPdf } from '@/lib/pdf/render';
import { buildProposalHtml } from '@/lib/pdf/proposal-template';
import { can, canSeeMargin } from '@/lib/permissions/can';
import { MAX_TOTAL_LINES } from '@/lib/proposals/core';
import { getProposalForPdf } from '@/lib/proposals/queries';

// Chromium is Node-only; this API endpoint gates itself (the i18n matcher skips /api).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Client is the default; only ?variant=internal opts into the cost copy.
  const variant =
    new URL(req.url).searchParams.get('variant') === 'internal'
      ? 'internal'
      : 'client';

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'read')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [org] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        nameEn: organizations.nameEn,
        nameAr: organizations.nameAr,
        hide: organizations.hideMarginFromPm,
        defaultLocale: organizations.defaultLocale,
      })
      .from(organizations)
      .limit(1),
  );
  const seeMargin = canSeeMargin(ctx.role, org?.hide ?? true);

  // The internal (cost) copy is margin-gated; everyone else gets the client copy.
  if (variant === 'internal' && !seeMargin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Load cost only for the internal copy; the client copy never fetches cost.
  const detail = await getProposalForPdf(ctx, id, variant === 'internal');
  if (!detail) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // R4: refuse to render a DOM larger than the R2 line cap (protects maxDuration).
  const lineCount = detail.sections.reduce((n, s) => n + s.lines.length, 0);
  if (lineCount > MAX_TOTAL_LINES) {
    return NextResponse.json({ error: 'Proposal too large to render' }, { status: 413 });
  }

  try {
    const locale = org?.defaultLocale ?? 'ar-EG';
    const html = await buildProposalHtml(detail, {
      locale,
      variant,
      orgNameAr: org?.nameAr ?? null,
      orgNameEn: org?.nameEn ?? null,
    });
    const pdf = await renderPdf(html);
    const suffix = variant === 'internal' ? '-internal' : '';
    return new NextResponse(pdf as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="proposal-${detail.number}${suffix}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Proposal PDF render failed:', err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}
