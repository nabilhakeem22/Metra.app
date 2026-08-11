import 'server-only';
import { clients, type Client } from '@metra/db';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ListClientsFilter {
  active?: boolean;
  q?: string;
}

/** Org-scoped clients, optionally filtered, ordered by name then created. */
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
        or(ilike(clients.nameEn, pattern), ilike(clients.nameAr, pattern)),
      );
    }
    return tx
      .select()
      .from(clients)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(clients.nameEn), asc(clients.createdAt));
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
