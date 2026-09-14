import { boqs, clients, organizations, projects } from '@metra/db';
import { eq } from 'drizzle-orm';
import { MAX_BOQ_LINES } from '@/lib/boqs/core';
import { getProjectBoq } from '@/lib/boqs/queries';
import type { BoqDetail } from '@/lib/boqs/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { buildBoqHtml } from '@/lib/pdf/boq-template';
import { pickBilingual } from '@/lib/pdf/html';
import { servePdfDocument, type PdfHeader } from '@/lib/pdf/route-handler';

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
 * whatever the template chooses to render. The 403 in servePdfDocument, which
 * runs BEFORE this load, is the second lock, not the only one.
 */
interface BoqPdfHeader {
  boqId: string;
  projectId: string;
  createdAt: Date | string;
  clientName: (locale: string) => string;
  projectName: (locale: string) => string;
}

/**
 * The header, in ONE transaction: the org row every PDF needs joined to the
 * client and project names only this one needs.
 *
 * The org row is joined here rather than read by the handler on its own, because
 * a separate read is a separate RLS transaction — BEGIN, the three SET LOCALs,
 * the SELECT, COMMIT — on a route whose budget is a five-second render. No cost
 * column is selected: this runs before the margin gate.
 */
async function loadBoqHeader(
  ctx: OrgContext,
  id: string,
): Promise<PdfHeader<BoqPdfHeader> | null> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        boqId: boqs.id,
        projectId: boqs.projectId,
        createdAt: boqs.createdAt,
        clientAr: clients.nameAr,
        clientEn: clients.nameEn,
        projectAr: projects.nameAr,
        projectEn: projects.nameEn,
        orgAr: organizations.nameAr,
        orgEn: organizations.nameEn,
        defaultLocale: organizations.defaultLocale,
        hideMarginFromPm: organizations.hideMarginFromPm,
      })
      .from(boqs)
      .innerJoin(clients, eq(clients.id, boqs.clientId))
      .innerJoin(projects, eq(projects.id, boqs.projectId))
      .innerJoin(organizations, eq(organizations.id, boqs.orgId))
      .where(eq(boqs.id, id))
      .limit(1),
  );
  if (!row) return null;
  return {
    org: {
      nameAr: row.orgAr,
      nameEn: row.orgEn,
      defaultLocale: row.defaultLocale,
      hideMarginFromPm: row.hideMarginFromPm,
    },
    header: {
      boqId: row.boqId,
      projectId: row.projectId,
      createdAt: row.createdAt,
      clientName: (locale) => pickBilingual(row.clientAr, row.clientEn, locale),
      projectName: (locale) => pickBilingual(row.projectAr, row.projectEn, locale),
    },
  };
}

/** The priced body, after the margin gate. `showCost` decides what is FETCHED. */
async function loadBoqDetail(
  ctx: OrgContext,
  header: BoqPdfHeader,
  showCost: boolean,
): Promise<BoqDetail | null> {
  const detail = await getProjectBoq(ctx, header.projectId, { showCost });
  return detail && detail.id === header.boqId ? detail : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return servePdfDocument(req, id, {
    capability: 'boq_build',
    logLabel: 'BOQ',
    maxLines: MAX_BOQ_LINES,
    loadHeader: loadBoqHeader,
    load: (ctx, _boqId, showCost, header) => loadBoqDetail(ctx, header, showCost),
    lineCount: (detail) => detail.lineCount,
    buildHtml: (detail, { locale, variant, org, header }) =>
      buildBoqHtml(detail, {
        locale,
        variant,
        orgName: pickBilingual(org.nameAr, org.nameEn, locale),
        clientName: header.clientName(locale),
        projectName: header.projectName(locale),
        year: new Date(header.createdAt).getUTCFullYear(),
      }),
    fileName: (detail, variant) =>
      `boq-${detail.number}${variant === 'internal' ? '-internal' : ''}.pdf`,
  });
}
