import 'server-only';
// The dashboard's DELIVERIES TRIAGE list. Not a register: a register answers
// "what exists", this answers "what needs me". Split out of a 210-line
// `dashboard/queries.ts` — see ./index.ts.
import { clients, designEngagements, projects } from '@metra/db';
import { asc, eq, notInArray, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { loadWhoseMovesInTx } from '@/lib/engagements/queries/whose-move';
import type { DesignState } from '@/lib/engagements/states';
import { TERMINAL_STATES } from '@/lib/engagements/states';
import type { WhoseMove } from '@/lib/engagements/whose-move';
import { orderForTriage } from '../triage-order';

/** The three off-ramps, as the array drizzle's `notInArray` wants. */
const TERMINAL = [...TERMINAL_STATES];

/**
 * How many in-flight deliveries are ordered for triage before the panel's cap
 * is applied. Whose move it is cannot be sorted in SQL, so the oldest this many
 * are read, ordered (triage-order.ts), then capped. Past it, the newest
 * untouched deliveries are not considered (the same bound as the list's "My move").
 */
const TRIAGE_POOL = 200;

/**
 * One in-flight delivery, as the dashboard panel needs it.
 *
 * Deliberately NOT `EngagementListRow`: that row is built for a register you
 * search (it leads with a document number and sorts newest-first). This one is
 * built for triage, so it carries the last-touched stamp the panel sorts and
 * colours by, and nothing it does not render.
 */
export interface DashboardDelivery {
  id: string;
  state: DesignState;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
  /** Last write of any kind. ISO. */
  updatedAt: string;
  /** Whose move it is, by the delivery page's own rule (not guessed from the state name). */
  whoseMove: WhoseMove;
}

/**
 * The deliveries still in flight, THE STUDIO'S MOVES FIRST, then those waiting
 * on the client, longest untouched first within each (triage-order.ts).
 *
 * That ordering is the whole reason this panel is not the Deliveries table: a
 * register answers "what exists", a dashboard answers "what needs me". Capped,
 * because a panel that grows without bound stops being a summary: the header
 * links to the full list for everything past the cap.
 *
 * `updated_at` is the honest signal available for free: it moves on ANY write,
 * so it answers "has anyone touched this", not "has it advanced a stage". Good
 * enough to sort a triage list by, and the panel's wording says "since it moved"
 * rather than claiming progress.
 */
export function listDashboardDeliveries(
  ctx: OrgContext,
  limit: number,
): Promise<DashboardDelivery[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: designEngagements.id,
        state: designEngagements.state,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
        updatedAt: designEngagements.updatedAt,
      })
      .from(designEngagements)
      .leftJoin(clients, eq(clients.id, designEngagements.clientId))
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .where(notInArray(designEngagements.state, TERMINAL))
      .orderBy(asc(designEngagements.updatedAt))
      .limit(Math.max(limit, TRIAGE_POOL));
    // A constant ≤ 7 reads for the whole pool, in the same transaction.
    const moves = await loadWhoseMovesInTx(tx, ctx.role, rows);
    const deliveries = rows.map((r) => ({
      ...r,
      updatedAt: r.updatedAt.toISOString(),
      whoseMove: moves.get(r.id) ?? 'studio',
    }));
    return orderForTriage(deliveries).slice(0, limit);
  });
}

/**
 * How many deliveries are in flight — the number the panel's badge shows so the
 * header can say what the cap is hiding.
 *
 * It exists SEPARATELY from `getDashboardCounts` because it belongs to the
 * panel, not to the firm-wide block: a role entitled to the work list but not to
 * firm figures (a project_manager) must still be told the true size of the list
 * it is looking at — `deliveries.length` would say 6 when there are forty. It
 * counts exactly the rows `listDashboardDeliveries` selects from, so withholding
 * it while showing the list would be incoherent rather than private. Callers
 * that already have the firm block read it from there and do not issue this.
 */
export function countActiveDeliveries(ctx: OrgContext): Promise<number> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({ active: sql<number>`count(*)::int` })
      .from(designEngagements)
      .where(notInArray(designEngagements.state, TERMINAL));
    return row?.active ?? 0;
  });
}
