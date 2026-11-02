import 'server-only';
import { clients, projects, type Client } from '@metra/db';
import { and, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ListClientsFilter {
  active?: boolean;
  q?: string;
}

/** The list filter as WHERE predicates: the active flag, then the name/email search. */
function clientSearchConditions(filter: ListClientsFilter): Array<SQL | undefined> {
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
  return conds;
}

/** Org-scoped clients, optionally filtered, ordered by name then created.
 *  Search covers name (both locales) AND email — the two things a studio actually
 *  remembers about a client. */
export function listClients(
  ctx: OrgContext,
  filter: ListClientsFilter = {},
): Promise<Client[]> {
  return withOrgContext(ctx, (tx) => {
    const conds = clientSearchConditions(filter);
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
    const conds = clientSearchConditions(filter);
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
