import 'server-only';
// The builder's preview of a BOQ working copy: the BOQ template, not the
// quotation one, numbered DRAFT (the real BQ number is allocated when it is
// sent), with no VAT and no supervision. Called by `proposals/preview-html.ts`,
// which has already refused the internal variant to a margin-blind caller; the
// cost is loaded here only for the internal variant all the same.
import { proposals } from '@metra/db';
import { eq } from 'drizzle-orm';
import type { ActionResult } from '@/lib/actions/result';
import { loadDocumentNames } from '@/lib/boqs/issue';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { buildBoqHtml } from '@/lib/pdf/boq-template';
import { pickBilingual, pickEscaped } from '@/lib/pdf/html';
import { toBoqDetail } from './detail';
import { mapProposalToBoq, type ProposalSourceSection } from './map';
import { loadProposalSource } from './source';

interface PreviewSource {
  header: {
    titleAr: string | null;
    titleEn: string | null;
    currency: string;
    discountPct: string;
    clientId: string;
    projectId: string;
  };
  source: ProposalSourceSection[];
}

async function readPreviewSource(
  ctx: OrgContext,
  proposalId: string,
  includeCost: boolean,
): Promise<PreviewSource | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        kind: proposals.kind,
        titleAr: proposals.titleAr,
        titleEn: proposals.titleEn,
        currency: proposals.currency,
        discountPct: proposals.discountPct,
        clientId: proposals.clientId,
        projectId: proposals.projectId,
      })
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .limit(1);
    if (!row || row.kind !== 'boq') return null;
    const { kind: _kind, ...header } = row;
    return { header, source: await loadProposalSource(tx, proposalId, { includeCost }) };
  });
}

export async function renderBoqProposalPreviewHtml(
  ctx: OrgContext,
  input: { proposalId: string; variant: 'client' | 'internal'; locale: string; orgName: string },
): Promise<ActionResult & { html?: string }> {
  const internal = input.variant === 'internal';
  const read = await readPreviewSource(ctx, input.proposalId, internal);
  if (!read) return { ok: false, error: 'invalid' };
  const names = await loadDocumentNames(ctx, read.header);
  if (!names) return { ok: false, error: 'invalid' };

  const { header } = read;
  const detail = toBoqDetail(
    mapProposalToBoq(read.source, header.discountPct),
    {
      number: 0,
      title: pickBilingual(header.titleAr, header.titleEn, input.locale),
      currency: header.currency,
      discountPct: header.discountPct,
    },
    { showCost: internal },
  );
  const html = await buildBoqHtml(detail, {
    locale: input.locale,
    variant: input.variant,
    orgName: input.orgName,
    clientName: pickBilingual(names.clientAr, names.clientEn, input.locale),
    projectName: pickBilingual(names.projectAr, names.projectEn, input.locale),
    year: new Date().getUTCFullYear(),
    numberLabel: pickEscaped('مسودة', 'DRAFT', input.locale),
  });
  return { ok: true, html };
}
