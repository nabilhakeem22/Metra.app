import { getContractForPdf } from '@/lib/contracts/queries';
import { buildContractHtml } from '@/lib/pdf/contract-template';
import { servePdfDocument } from '@/lib/pdf/route-handler';
import { MAX_TOTAL_LINES } from '@/lib/lines/limits';

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
    capability: 'contracts_generate',
    logLabel: 'Contract',
    maxLines: MAX_TOTAL_LINES,
    load: (ctx, contractId, showCost) => getContractForPdf(ctx, contractId, showCost),
    lineCount: (detail) => detail.sections.reduce((n, s) => n + s.lines.length, 0),
    buildHtml: (detail, { locale, variant, org }) =>
      buildContractHtml(detail, {
        locale,
        variant,
        orgNameAr: org.nameAr,
        orgNameEn: org.nameEn,
      }),
    fileName: (detail, variant) =>
      `contract-${detail.number}${variant === 'internal' ? '-internal' : ''}.pdf`,
  });
}
