import 'server-only';
import { clients, designEngagements, projects, type DesignEngagementState } from '@metra/db';
import { desc, eq } from 'drizzle-orm';
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

/**
 * Org-scoped engagements, newest first (by per-org number descending), each with
 * whose move it is. That costs a constant ≤ 7 reads in the same transaction
 * however many rows there are (`loadWhoseMovesInTx`); terminal rows cost none.
 */
export function listEngagements(ctx: OrgContext): Promise<EngagementListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
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
      .orderBy(desc(designEngagements.number));
    const moves = await loadWhoseMovesInTx(tx, ctx.role, rows);
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      whoseMove: moves.get(r.id) ?? 'studio',
    }));
  });
}
