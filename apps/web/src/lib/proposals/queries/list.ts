import 'server-only';
import {
  clients,
  projects,
  proposals,
  type ProposalStatus,
} from '@metra/db';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ProposalListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ProposalStatus;
  total: string;
  currency: string;
  issueDate: string | null;
  createdAt: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
}

export interface ListProposalsFilter {
  status?: ProposalStatus;
  projectId?: string;
  clientId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

// R5: always bounded — never stream an unbounded proposal set.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function listProposals(
  ctx: OrgContext,
  filter: ListProposalsFilter = {},
): Promise<ProposalListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conds = [];
    if (filter.status) conds.push(eq(proposals.status, filter.status));
    if (filter.projectId) conds.push(eq(proposals.projectId, filter.projectId));
    if (filter.clientId) conds.push(eq(proposals.clientId, filter.clientId));
    if (filter.q && filter.q.trim()) {
      const p = `%${filter.q.trim()}%`;
      conds.push(or(ilike(proposals.titleEn, p), ilike(proposals.titleAr, p)));
    }
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = await tx
      .select({
        id: proposals.id,
        number: proposals.number,
        titleAr: proposals.titleAr,
        titleEn: proposals.titleEn,
        status: proposals.status,
        total: proposals.total,
        currency: proposals.currency,
        issueDate: proposals.issueDate,
        createdAt: proposals.createdAt,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
      })
      .from(proposals)
      .leftJoin(clients, eq(clients.id, proposals.clientId))
      .leftJoin(projects, eq(projects.id, proposals.projectId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(proposals.number))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}
