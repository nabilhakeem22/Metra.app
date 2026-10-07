import 'server-only';
import {
  clients,
  designEngagements,
  projects,
  type DesignEngagementState,
  type MetraDb,
} from '@metra/db';
import { desc, eq, lt, notInArray, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { TERMINAL_STATES } from '../states';
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

/**
 * How many live deliveries "My move" looks through (DECIDE A9). Past this an org
 * sees the newest ones and is told the view is partial (`truncated`).
 */
export const MY_MOVE_SCAN_LIMIT = 200;

export interface EngagementListPage {
  rows: EngagementListRow[];
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextBefore: number | null;
  /** "My move" only: more live deliveries exist than it looked through. */
  truncated: boolean;
}

/** The list's columns for the newest `limit` deliveries matching `where`, each with whose move it is. */
async function readListRows(
  tx: MetraDb,
  role: OrgContext['role'],
  where: SQL | undefined,
  limit: number,
): Promise<{ rows: EngagementListRow[]; more: boolean }> {
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
    .where(where)
    .orderBy(desc(designEngagements.number))
    .limit(limit + 1);
  const page = fetched.slice(0, limit);
  const moves = await loadWhoseMovesInTx(tx, role, page);
  return {
    rows: page.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      whoseMove: moves.get(r.id) ?? 'studio',
    })),
    more: fetched.length > limit,
  };
}

/** Whose moves "My move" lists: the studio's own, and a client payment to confirm. */
const STUDIO_MOVES: ReadonlySet<WhoseMove> = new Set<WhoseMove>(['studio', 'confirmPayment']);

/**
 * One page of the org's engagements, newest first, by KEYSET on the per-org
 * `number` (unique, so the order is stable and a page never repeats or skips a
 * row however the list changes between clicks). Each row carries whose move it
 * is; that batch runs for THIS page only, a constant ≤ 7 reads in the same
 * transaction (`loadWhoseMovesInTx`), terminal rows costing none.
 *
 * `move: 'mine'` is the studio's to-do list: the newest MY_MOVE_SCAN_LIMIT live
 * deliveries, kept when the move is the studio's or a client payment waits to be
 * confirmed. One page, no cursor; `truncated` when more live ones exist.
 */
export function listEngagements(
  ctx: OrgContext,
  page: { before?: number; size?: number; move?: 'mine' } = {},
): Promise<EngagementListPage> {
  return withOrgContext(ctx, async (tx) => {
    if (page.move === 'mine') {
      const live = notInArray(designEngagements.state, [...TERMINAL_STATES]);
      const { rows, more } = await readListRows(tx, ctx.role, live, MY_MOVE_SCAN_LIMIT);
      return {
        rows: rows.filter((row) => STUDIO_MOVES.has(row.whoseMove)),
        nextBefore: null,
        truncated: more,
      };
    }
    const size = page.size ?? ENGAGEMENT_PAGE_SIZE;
    const before = page.before === undefined ? undefined : lt(designEngagements.number, page.before);
    const { rows, more } = await readListRows(tx, ctx.role, before, size);
    return { rows, nextBefore: more ? rows[rows.length - 1].number : null, truncated: false };
  });
}
