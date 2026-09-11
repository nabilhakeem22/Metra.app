import { boqs, clients, organizations, projects } from '@metra/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { MAX_BOQ_LINES } from '@/lib/boqs/core';
import { getProjectBoq } from '@/lib/boqs/queries';
import { withOrgContext } from '@/lib/db/context';
import { buildBoqHtml } from '@/lib/pdf/boq-template';
import { renderPdf, RendererBusyError } from '@/lib/pdf/render';
import { can, canSeeMargin } from '@/lib/permissions/can';

// Chromium is Node-only; this API endpoint gates itself (the i18n matcher skips /api).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Render a BOQ as a PDF.
 *
 * The CLIENT copy is produced once, at issue, and stored as the engagement's
 * artifact — that rendition is the one the client is entitled to, and it is
 * withheld until the balance clears. This route is the INTERNAL one: the same
 * document with the cost and margin columns, for the studio's own use, rendered
 * on demand from whatever the draft currently says.
 *
 * THE GATE IS AT THE QUERY, NOT THE VIEW. `getProjectBoq({ showCost })` decides
 * whether cost fields are fetched at all, so a margin-blind role never receives
 * the numbers in the first place — anything sent to a browser is readable
 * whatever the template chooses to render. The 403 above it is the second lock,
 * not the only one.
 */
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
  if (!can(ctx.role, 'boq_build', 'read')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        boqId: boqs.id,
        number: boqs.number,
        projectId: boqs.projectId,
        createdAt: boqs.createdAt,
        orgAr: organizations.nameAr,
        orgEn: organizations.nameEn,
        clientAr: clients.nameAr,
        clientEn: clients.nameEn,
        projectAr: projects.nameAr,
        projectEn: projects.nameEn,
        hide: organizations.hideMarginFromPm,
        defaultLocale: organizations.defaultLocale,
      })
      .from(boqs)
      .innerJoin(organizations, eq(organizations.id, boqs.orgId))
      .innerJoin(clients, eq(clients.id, boqs.clientId))
      .innerJoin(projects, eq(projects.id, boqs.projectId))
      .where(eq(boqs.id, id))
      .limit(1),
  );
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const seeMargin = canSeeMargin(ctx.role, row.hide ?? true);
  if (variant === 'internal' && !seeMargin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const detail = await getProjectBoq(ctx, row.projectId, {
    showCost: variant === 'internal',
  });
  if (!detail || detail.id !== row.boqId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Refuse to render a DOM larger than the line cap the importer enforces —
  // the same protection the proposal route applies to maxDuration.
  if (detail.lineCount > MAX_BOQ_LINES) {
    return NextResponse.json({ error: 'BOQ too large to render' }, { status: 413 });
  }

  const locale = row.defaultLocale;
  const ar = locale.startsWith('ar');
  const pick = (a: string | null, e: string | null) => (ar ? (a ?? e) : (e ?? a)) ?? '';
  try {
    const html = await buildBoqHtml(detail, {
      locale,
      variant,
      orgName: pick(row.orgAr, row.orgEn),
      clientName: pick(row.clientAr, row.clientEn),
      projectName: pick(row.projectAr, row.projectEn),
      year: new Date(row.createdAt).getUTCFullYear(),
    });
    const pdf = await renderPdf(html);
    const suffix = variant === 'internal' ? '-internal' : '';
    return new NextResponse(pdf as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="boq-${row.number}${suffix}.pdf"`,
        // The costed copy carries the firm's margin: never cached, not even
        // privately, so it cannot be read back out of a shared machine's disk.
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof RendererBusyError) {
      console.error('BOQ PDF renderer busy:', err);
      return NextResponse.json(
        { error: 'Renderer busy, try again' },
        { status: 503, headers: { 'retry-after': '5' } },
      );
    }
    console.error('BOQ PDF render failed:', err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}
