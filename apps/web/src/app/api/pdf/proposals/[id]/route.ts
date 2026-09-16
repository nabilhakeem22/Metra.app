import { buildProposalHtml } from '@/lib/pdf/proposal-template';
import { servePdfDocument } from '@/lib/pdf/route-handler';
import { MAX_TOTAL_LINES } from '@/lib/lines/limits';
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
  return servePdfDocument(req, id, {
    capability: 'proposals_build',
    logLabel: 'Proposal',
    maxLines: MAX_TOTAL_LINES,
    load: (ctx, proposalId, showCost) => getProposalForPdf(ctx, proposalId, showCost),
    lineCount: (detail) => detail.sections.reduce((n, s) => n + s.lines.length, 0),
    buildHtml: (detail, { locale, variant, org }) =>
      buildProposalHtml(detail, {
        locale,
        variant,
        orgNameAr: org.nameAr,
        orgNameEn: org.nameEn,
      }),
    fileName: (detail, variant) =>
      `proposal-${detail.number}${variant === 'internal' ? '-internal' : ''}.pdf`,
  });
}
