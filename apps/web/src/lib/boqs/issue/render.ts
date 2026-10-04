import 'server-only';
import type { OrgContext } from '@/lib/db/context';
import { formatDocNumber } from '@/lib/format/doc-number';
import { buildBoqHtml } from '@/lib/pdf/boq-template';
import { renderPdf } from '@/lib/pdf/render';
import { storeGeneratedFile } from '@/lib/storage/uploads';
import type { BoqDetail } from '../queries';
import type { DocumentNames } from './document-names';

/**
 * Render the CLIENT copy of a BOQ and store it as an engagement file.
 *
 * The delivered copy is always the client one. An internal costed copy is a
 * separate on-demand download, never the thing that reaches the portal.
 *
 * This runs OUTSIDE any write transaction: Chromium takes seconds, and a
 * transaction held open across it would hold row locks for that whole time. Both
 * issue paths call it first and write afterwards, so a failed render writes
 * nothing to the BOQ tables.
 *
 * `year` is the year the document number prints, which must be the UTC year of
 * the BOQ's `created_at`: the step summary formats the same number from that
 * column, and the two must never disagree.
 */
export async function renderAndStoreClientBoqPdf(
  ctx: OrgContext,
  input: {
    detail: BoqDetail;
    engagementId: string;
    locale: string;
    names: DocumentNames;
    year: number;
  },
): Promise<{ fileId: string; label: string }> {
  const { detail, names, locale, year } = input;
  const ar = locale.startsWith('ar');
  const pick = (a: string | null, e: string | null) =>
    (ar ? (a ?? e) : (e ?? a)) ?? '';

  const html = await buildBoqHtml(detail, {
    locale,
    variant: 'client',
    orgName: pick(names.orgAr, names.orgEn),
    clientName: pick(names.clientAr, names.clientEn),
    projectName: pick(names.projectAr, names.projectEn),
    year,
  });

  const pdf = await renderPdf(html);
  const label = `${formatDocNumber('BQ', detail.number, year)}.pdf`;

  const stored = await storeGeneratedFile(ctx, 'engagement', pdf, {
    originalName: label,
    contentType: 'application/pdf',
    entityId: input.engagementId,
  });
  return { fileId: stored.fileId, label };
}
