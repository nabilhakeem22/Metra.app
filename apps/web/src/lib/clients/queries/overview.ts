import 'server-only';
import { activities, projects, proposals, type Activity, type MetraDb } from '@metra/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { contractedValue } from '../financials';

export interface ClientOverview {
  projectCount: number;
  activeProposalCount: number;
  /**
   * Every committed (issued or signed) contract of this client at its revised
   * value, as its contract page shows it, plus each accepted proposal with no
   * committed contract at its total (`contractedValue`, as on a project).
   * Scale-4 money string.
   */
  contractedTotal: string;
  recentActivity: Activity[];
  // Invoiced/outstanding are intentionally ABSENT — the UI renders a locked
  // state until invoicing ships. No demo numbers.
}

/** How many projects the client has. */
async function countClientProjects(tx: MetraDb, clientId: string): Promise<number> {
  const [projRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.clientId, clientId));
  return Number(projRow?.n ?? 0);
}

/** How many of the client's quotes are still open (draft or sent). */
async function countActiveQuoteProposals(tx: MetraDb, clientId: string): Promise<number> {
  const [activeRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(proposals)
    .where(
      and(
        eq(proposals.clientId, clientId),
        inArray(proposals.status, ['draft', 'sent']),
        // A BOQ working copy is a draft forever and is not an offer.
        eq(proposals.kind, 'quote'),
      ),
    );
  return Number(activeRow?.n ?? 0);
}

/** The client's five newest activity entries, newest first. */
function recentClientActivity(tx: MetraDb, clientId: string): Promise<Activity[]> {
  return tx
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.entityType, 'client'),
        eq(activities.entityId, clientId),
      ),
    )
    .orderBy(desc(activities.createdAt))
    .limit(5);
}

/** Overview figures for a client's profile: real counts + contracted total. */
export function getClientOverview(
  ctx: OrgContext,
  clientId: string,
): Promise<ClientOverview> {
  return withOrgContext(ctx, async (tx) => {
    const projectCount = await countClientProjects(tx, clientId);
    const activeProposalCount = await countActiveQuoteProposals(tx, clientId);
    const contractedTotal = await contractedValue(tx, { column: 'clientId', id: clientId });
    const recentActivity = await recentClientActivity(tx, clientId);
    return { projectCount, activeProposalCount, contractedTotal, recentActivity };
  });
}
