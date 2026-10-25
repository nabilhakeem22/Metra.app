import 'server-only';
import {
  clients,
  projects,
  proposals,
  type MetraDb,
  type ProposalKind,
  type ProposalStatus,
} from '@metra/db';
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { boundedPage } from '@/lib/db/list-bounds';
import {
  REGISTER_PAGE_SIZE,
  registerPageWindow,
  type RegisterPage,
} from '@/lib/registers/register-view';
import { everyWordSql } from '@/lib/search/words-sql';

export interface ProposalListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ProposalStatus;
  /** A `boq` row renders a BOQ tag in place of its Q- number. */
  kind: ProposalKind;
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

export interface ListProposalsPageFilter extends Omit<ListProposalsFilter, 'limit' | 'offset'> {
  /** 1-based; a page past the end reads as the last page. */
  page: number;
}

export interface ProposalRegisterPage extends RegisterPage<ProposalListRow> {
  /** Whether the studio has any proposal at all, whatever the filter: none offers to make one. */
  hasAnyProposal: boolean;
}

/** The register's columns, as DATA. No cost or margin reaches this surface. */
const PROPOSAL_LIST_COLUMNS = {
  id: proposals.id,
  number: proposals.number,
  titleAr: proposals.titleAr,
  titleEn: proposals.titleEn,
  status: proposals.status,
  kind: proposals.kind,
  total: proposals.total,
  currency: proposals.currency,
  issueDate: proposals.issueDate,
  createdAt: proposals.createdAt,
  clientNameEn: clients.nameEn,
  clientNameAr: clients.nameAr,
  projectNameEn: projects.nameEn,
  projectNameAr: projects.nameAr,
} as const;

/**
 * What a search reads of a proposal: its number and both titles. A BOQ working
 * copy's Q- number is never shown, so it is not searchable.
 */
const SEARCHED_TEXT = sql`concat_ws(' ', case when ${proposals.kind} = 'quote' then ${proposals.number}::text end, ${proposals.titleEn}, ${proposals.titleAr})`;

/** The filter as SQL, over `proposals` alone. Every typed word must appear, folded (أ/ا, ة/ه, digits). */
function listConditions(filter: Omit<ListProposalsFilter, 'limit' | 'offset'>): SQL | undefined {
  return and(
    filter.status ? eq(proposals.status, filter.status) : undefined,
    filter.projectId ? eq(proposals.projectId, filter.projectId) : undefined,
    filter.clientId ? eq(proposals.clientId, filter.clientId) : undefined,
    everyWordSql(SEARCHED_TEXT, filter.q ?? ''),
  );
}

/** The rows of one window of the register, newest number first. */
async function readRows(
  tx: MetraDb,
  where: SQL | undefined,
  window: { limit: number; offset: number },
): Promise<ProposalListRow[]> {
  const rows = await tx
    .select(PROPOSAL_LIST_COLUMNS)
    .from(proposals)
    .leftJoin(clients, eq(clients.id, proposals.clientId))
    .leftJoin(projects, eq(projects.id, proposals.projectId))
    .where(where)
    .orderBy(desc(proposals.number))
    .limit(window.limit)
    .offset(window.offset);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export function listProposals(
  ctx: OrgContext,
  filter: ListProposalsFilter = {},
): Promise<ProposalListRow[]> {
  return withOrgContext(ctx, (tx) => readRows(tx, listConditions(filter), boundedPage(filter)));
}

/**
 * One page of the proposal register and how many match. The count reads
 * `proposals` alone (no join), in the same transaction, so the page asked for is
 * clamped to the last one before any row is read: a page past the end (an old
 * link) shows the last page, never an error. Only a filter that matches nothing
 * asks whether there is any proposal at all.
 */
export function listProposalsPage(
  ctx: OrgContext,
  filter: ListProposalsPageFilter,
): Promise<ProposalRegisterPage> {
  return withOrgContext(ctx, async (tx) => {
    const where = listConditions(filter);
    const [{ total }] = await tx.select({ total: count() }).from(proposals).where(where);
    const { page, offset } = registerPageWindow(total, filter.page);
    if (total > 0) {
      const rows = await readRows(tx, where, { limit: REGISTER_PAGE_SIZE, offset });
      return { rows, total, page, hasAnyProposal: true };
    }
    const [anyProposal] = where === undefined ? [] : await tx.select({ id: proposals.id }).from(proposals).limit(1);
    return { rows: [], total, page, hasAnyProposal: anyProposal !== undefined };
  });
}
