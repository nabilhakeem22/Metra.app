import 'server-only';
import {
  clients,
  contracts,
  projects,
  type ContractStatus,
} from '@metra/db';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ContractListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ContractStatus;
  originalValue: string;
  currency: string;
  createdAt: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
}

export interface ListContractsFilter {
  status?: ContractStatus;
  projectId?: string;
  clientId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function listContracts(
  ctx: OrgContext,
  filter: ListContractsFilter = {},
): Promise<ContractListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conds = [];
    if (filter.status) conds.push(eq(contracts.status, filter.status));
    if (filter.projectId) conds.push(eq(contracts.projectId, filter.projectId));
    if (filter.clientId) conds.push(eq(contracts.clientId, filter.clientId));
    if (filter.q && filter.q.trim()) {
      const p = `%${filter.q.trim()}%`;
      conds.push(or(ilike(contracts.titleEn, p), ilike(contracts.titleAr, p)));
    }
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = await tx
      .select({
        id: contracts.id,
        number: contracts.number,
        titleAr: contracts.titleAr,
        titleEn: contracts.titleEn,
        status: contracts.status,
        originalValue: contracts.originalValue,
        currency: contracts.currency,
        createdAt: contracts.createdAt,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
      })
      .from(contracts)
      .leftJoin(clients, eq(clients.id, contracts.clientId))
      .leftJoin(projects, eq(projects.id, contracts.projectId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contracts.number))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}
