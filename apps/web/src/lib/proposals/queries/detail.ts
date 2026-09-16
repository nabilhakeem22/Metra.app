import 'server-only';
// The full proposal, margin-gated: header, sections with their lines. Three named
// phases — load the header (./detail-header.ts), load the sections
// (./detail-sections.ts), assemble — rather than one 149-line function.
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { loadProposalHeader } from './detail-header';
import { loadProposalSections } from './detail-sections';
import type { ProposalDetail } from './detail-types';

export type {
  ProposalDetail,
  ProposalDetailLine,
  ProposalDetailSection,
} from './detail-types';

async function loadDetail(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ProposalDetail | null> {
  return withOrgContext(ctx, async (tx) => {
    const header = await loadProposalHeader(tx, id);
    if (!header) return null;

    const { createdAt, totalCost, totalMargin, ...rest } = header;
    return {
      ...rest,
      createdAt: createdAt.toISOString(),
      sections: await loadProposalSections(tx, id, canSeeMargin),
      // Absent, not null, when the caller may not see margin.
      ...(canSeeMargin ? { totalCost, totalMargin } : {}),
    };
  });
}

export function getProposalWithLines(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ProposalDetail | null> {
  return loadDetail(ctx, id, canSeeMargin);
}

export function getProposalForPdf(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ProposalDetail | null> {
  return loadDetail(ctx, id, canSeeMargin);
}
