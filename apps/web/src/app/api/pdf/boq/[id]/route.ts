import { boqs, clients, projects } from '@metra/db';
import { eq } from 'drizzle-orm';
import { MAX_BOQ_LINES } from '@/lib/boqs/core';
import { getProjectBoq } from '@/lib/boqs/queries';
import type { BoqDetail } from '@/lib/boqs/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { buildBoqHtml } from '@/lib/pdf/boq-template';
import { pickBilingual } from '@/lib/pdf/html';
import { servePdfDocument } from '@/lib/pdf/route-handler';

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
interface BoqPdfDocument {
  detail: BoqDetail;
  number: number;
  createdAt: Date | string;
  clientName: (locale: string) => string;
  projectName: (locale: string) => string;
}

/** The BOQ's header carries the client and project names, which no other PDF
 *  needs, so they are loaded here rather than widened into PdfOrg. */
async function loadBoqDocument(
  ctx: OrgContext,
  id: string,
  showCost: boolean,
): Promise<BoqPdfDocument | null> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        boqId: boqs.id,
        number: boqs.number,
        projectId: boqs.projectId,
        createdAt: boqs.createdAt,
        clientAr: clients.nameAr,
        clientEn: clients.nameEn,
        projectAr: projects.nameAr,
        projectEn: projects.nameEn,
      })
      .from(boqs)
      .innerJoin(clients, eq(clients.id, boqs.clientId))
      .innerJoin(projects, eq(projects.id, boqs.projectId))
      .where(eq(boqs.id, id))
      .limit(1),
  );
  if (!row) return null;

  const detail = await getProjectBoq(ctx, row.projectId, { showCost });
  if (!detail || detail.id !== row.boqId) return null;
  return {
    detail,
    number: row.number,
    createdAt: row.createdAt,
    clientName: (locale) => pickBilingual(row.clientAr, row.clientEn, locale),
    projectName: (locale) => pickBilingual(row.projectAr, row.projectEn, locale),
  };
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
    load: loadBoqDocument,
    lineCount: (document) => document.detail.lineCount,
    buildHtml: (document, { locale, variant, org }) =>
      buildBoqHtml(document.detail, {
        locale,
        variant,
        orgName: pickBilingual(org.nameAr, org.nameEn, locale),
        clientName: document.clientName(locale),
        projectName: document.projectName(locale),
        year: new Date(document.createdAt).getUTCFullYear(),
      }),
    fileName: (document, variant) =>
      `boq-${document.number}${variant === 'internal' ? '-internal' : ''}.pdf`,
  });
}
