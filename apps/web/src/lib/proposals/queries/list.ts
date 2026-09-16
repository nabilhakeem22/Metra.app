import 'server-only';
import {
  clients,
  projects,
  proposals,
  type ProposalStatus,
} from '@metra/db';
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { boundedPage } from '@/lib/db/list-bounds';

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

/** The register's columns, as DATA. No cost or margin reaches this surface. */
const PROPOSAL_LIST_COLUMNS = {
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
} as const;

/** The filter as SQL. `q` matches either title, so an Arabic-only one still finds. */
function listConditions(filter: ListProposalsFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(proposals.status, filter.status));
  if (filter.projectId) conditions.push(eq(proposals.projectId, filter.projectId));
  if (filter.clientId) conditions.push(eq(proposals.clientId, filter.clientId));
  if (filter.q && filter.q.trim()) {
    const pattern = `%${filter.q.trim()}%`;
    const match = or(
      ilike(proposals.titleEn, pattern),
      ilike(proposals.titleAr, pattern),
    );
    if (match) conditions.push(match);
  }
  return conditions;
}

export function listProposals(
  ctx: OrgContext,
  filter: ListProposalsFilter = {},
): Promise<ProposalListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conditions = listConditions(filter);
    const page = boundedPage(filter);
    const rows = await tx
      .select(PROPOSAL_LIST_COLUMNS)
      .from(proposals)
      .leftJoin(clients, eq(clients.id, proposals.clientId))
      .leftJoin(projects, eq(projects.id, proposals.projectId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(proposals.number))
      .limit(page.limit)
      .offset(page.offset);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  });
}
