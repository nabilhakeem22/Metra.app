import 'server-only';
import {
  activities,
  clients,
  projects,
  proposals,
  type Activity,
  type Client,
} from '@metra/db';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ListClientsFilter {
  active?: boolean;
  q?: string;
}

/** Org-scoped clients, optionally filtered, ordered by name then created.
 *  Search covers name (both locales) AND email — the two things a studio actually
 *  remembers about a client. */
export function listClients(
  ctx: OrgContext,
  filter: ListClientsFilter = {},
): Promise<Client[]> {
  return withOrgContext(ctx, (tx) => {
    const conds = [];
    if (filter.active !== undefined) conds.push(eq(clients.active, filter.active));
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim()}%`;
      conds.push(
        or(
          ilike(clients.nameEn, pattern),
          ilike(clients.nameAr, pattern),
          ilike(clients.email, pattern),
        ),
      );
    }
    return tx
      .select()
      .from(clients)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(clients.nameEn), asc(clients.createdAt));
  });
}

/** A client row for the LIST, with the project count the table column needs.
 *  One grouped query — never a count per row. */
export type ClientListRow = Client & { projectCount: number };

/**
 * The list read: every client the filter admits, each carrying how many projects it
 * has. The count comes from a single LEFT JOIN + GROUP BY rather than a per-row
 * query, so a firm with 400 clients still makes one round trip.
 */
export function listClientsWithCounts(
  ctx: OrgContext,
  filter: ListClientsFilter = {},
): Promise<ClientListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conds = [];
    if (filter.active !== undefined) conds.push(eq(clients.active, filter.active));
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim()}%`;
      conds.push(
        or(
          ilike(clients.nameEn, pattern),
          ilike(clients.nameAr, pattern),
          ilike(clients.email, pattern),
        ),
      );
    }
    const rows = await tx
      .select({
        client: clients,
        projectCount: sql<number>`count(${projects.id})::int`,
      })
      .from(clients)
      .leftJoin(projects, eq(projects.clientId, clients.id))
      .where(conds.length ? and(...conds) : undefined)
      .groupBy(clients.id)
      .orderBy(asc(clients.nameEn), asc(clients.createdAt));
    return rows.map((r) => ({ ...r.client, projectCount: r.projectCount }));
  });
}

export interface ClientOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
}

/** Active clients only — for the project form's client select. */
export function getClientOptions(ctx: OrgContext): Promise<ClientOption[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({ id: clients.id, nameEn: clients.nameEn, nameAr: clients.nameAr })
      .from(clients)
      .where(eq(clients.active, true))
      .orderBy(asc(clients.nameEn)),
  );
}

/** One client by id (org-scoped via RLS). Null if not found in this org. */
export function getClientById(
  ctx: OrgContext,
  id: string,
): Promise<Client | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);
    return row ?? null;
  });
}

export interface ClientOverview {
  projectCount: number;
  activeProposalCount: number;
  /** Sum of ACCEPTED proposal totals for this client (scale-4 money string). */
  contractedTotal: string;
  recentActivity: Activity[];
  // Invoiced/outstanding are intentionally ABSENT — the UI renders a locked
  // state until invoicing ships. No demo numbers.
}

/** Overview figures for a client's profile: real counts + contracted total. */
export function getClientOverview(
  ctx: OrgContext,
  clientId: string,
): Promise<ClientOverview> {
  return withOrgContext(ctx, async (tx) => {
    const [projRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.clientId, clientId));

    const [activeRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(proposals)
      .where(
        and(
          eq(proposals.clientId, clientId),
          inArray(proposals.status, ['draft', 'sent']),
        ),
      );

    const [contractedRow] = await tx
      .select({
        total: sql<string>`coalesce(sum(${proposals.total}), 0)::text`,
      })
      .from(proposals)
      .where(
        and(
          eq(proposals.clientId, clientId),
          eq(proposals.status, 'accepted'),
        ),
      );

    const recentActivity = await tx
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

    return {
      projectCount: Number(projRow?.n ?? 0),
      activeProposalCount: Number(activeRow?.n ?? 0),
      contractedTotal: contractedRow?.total ?? '0',
      recentActivity,
    };
  });
}
