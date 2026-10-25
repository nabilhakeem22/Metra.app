import 'server-only';
import {
  clients,
  contracts,
  projects,
  type ContractStatus,
} from '@metra/db';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import {
  REGISTER_PAGE_SIZE,
  registerPageWindow,
  type RegisterPage,
} from '@/lib/registers/register-view';

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
  /** 1-based; a page past the end reads as the last page. */
  page: number;
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

/** The filter as SQL, over `contracts` alone. `q` matches either title, so an Arabic-only one still finds. */
function listConditions(filter: ListContractsFilter): SQL | undefined {
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
  return conditions.length ? and(...conditions) : undefined;
}

/**
 * One page of the contract register, newest number first, and how many match.
 * The count reads `contracts` alone (no join), in the same transaction, so the
 * page asked for is clamped to the last one before any row is read: a page past
 * the end (an old link) shows the last page, never an error.
 */
export function listContractsPage(
  ctx: OrgContext,
  filter: ListContractsFilter,
): Promise<RegisterPage<ContractListRow>> {
  return withOrgContext(ctx, async (tx) => {
    const where = listConditions(filter);
    const [{ total }] = await tx.select({ total: count() }).from(contracts).where(where);
    const { page, offset } = registerPageWindow(total, filter.page);
    if (total === 0) return { rows: [], total, page };
    const rows = await tx
      .select(CONTRACT_LIST_COLUMNS)
      .from(contracts)
      .leftJoin(clients, eq(clients.id, contracts.clientId))
      .leftJoin(projects, eq(projects.id, contracts.projectId))
      .where(where)
      .orderBy(desc(contracts.number))
      .limit(REGISTER_PAGE_SIZE)
      .offset(offset);
    return {
      rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      total,
      page,
    };
  });
}
