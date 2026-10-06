import 'server-only';
import { clients, designEngagements, projects, type DesignEngagementState } from '@metra/db';
import { desc, eq, lt } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { WhoseMove } from '../whose-move';
import { loadWhoseMovesInTx } from './whose-move';

/**
 * One row of the engagements list: the header fields the list surface renders
 * plus the client/project names joined in for display. Newest first (highest
 * per-org `number`). The CALLER gates the read on the `engagements_design` read
 * capability; RLS scopes it to the caller's org.
 */
export interface EngagementListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  clientId: string;
  projectId: string;
  state: DesignEngagementState;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
  createdAt: string;
  /** Last change of any kind (every state move stamps it). ISO. */
  updatedAt: string;
  /** Whose move it is, by the delivery page's own rule. */
  whoseMove: WhoseMove;
}

/** Rows per page of the deliveries list. */
export const ENGAGEMENT_PAGE_SIZE = 50;

export interface EngagementListPage {
  rows: EngagementListRow[];
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextBefore: number | null;
}

/**
 * One page of the org's engagements, newest first, by KEYSET on the per-org
 * `number` (unique, so the order is stable and a page never repeats or skips a
 * row however the list changes between clicks). Each row carries whose move it
 * is; that batch runs for THIS page only, a constant ≤ 7 reads in the same
 * transaction (`loadWhoseMovesInTx`), terminal rows costing none.
 */
export function listEngagements(
  ctx: OrgContext,
  page: { before?: number; size?: number } = {},
): Promise<EngagementListPage> {
  const size = page.size ?? ENGAGEMENT_PAGE_SIZE;
  return withOrgContext(ctx, async (tx) => {
    const fetched = await tx
      .select({
        id: designEngagements.id,
        number: designEngagements.number,
        titleAr: designEngagements.titleAr,
        titleEn: designEngagements.titleEn,
        clientId: designEngagements.clientId,
        projectId: designEngagements.projectId,
        state: designEngagements.state,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
        createdAt: designEngagements.createdAt,
        updatedAt: designEngagements.updatedAt,
      })
      .from(designEngagements)
      .leftJoin(clients, eq(clients.id, designEngagements.clientId))
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .where(page.before === undefined ? undefined : lt(designEngagements.number, page.before))
      .orderBy(desc(designEngagements.number))
      .limit(size + 1);
    const rows = fetched.slice(0, size);
    const moves = await loadWhoseMovesInTx(tx, ctx.role, rows);
    return {
      rows: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        whoseMove: moves.get(r.id) ?? 'studio',
      })),
      nextBefore: fetched.length > size ? rows[rows.length - 1].number : null,
    };
  });
}
