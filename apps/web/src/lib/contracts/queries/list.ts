import 'server-only';
import {
  clients,
  contracts,
  projects,
  type ContractStatus,
} from '@metra/db';
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { boundedPage } from '@/lib/db/list-bounds';

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

/** The register's columns, as DATA. No cost or margin reaches this surface. */
const CONTRACT_LIST_COLUMNS = {
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
} as const;

/** The filter as SQL. `q` matches either title, so an Arabic-only one still finds. */
function listConditions(filter: ListContractsFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(contracts.status, filter.status));
  if (filter.projectId) conditions.push(eq(contracts.projectId, filter.projectId));
  if (filter.clientId) conditions.push(eq(contracts.clientId, filter.clientId));
  if (filter.q && filter.q.trim()) {
    const pattern = `%${filter.q.trim()}%`;
    const match = or(
      ilike(contracts.titleEn, pattern),
      ilike(contracts.titleAr, pattern),
    );
    if (match) conditions.push(match);
  }
  return conditions;
}

export function listContracts(
  ctx: OrgContext,
  filter: ListContractsFilter = {},
): Promise<ContractListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conditions = listConditions(filter);
    const page = boundedPage(filter);
    const rows = await tx
      .select(CONTRACT_LIST_COLUMNS)
      .from(contracts)
      .leftJoin(clients, eq(clients.id, contracts.clientId))
      .leftJoin(projects, eq(projects.id, contracts.projectId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(contracts.number))
      .limit(page.limit)
      .offset(page.offset);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  });
}
