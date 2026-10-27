import 'server-only';
import { clients, type Client } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ClientOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  /** The client's location, which a new project for it starts with. */
  city: string | null;
  country: string | null;
}

/** Active clients only — for the project form's client select (with its location). */
export function getClientOptions(ctx: OrgContext): Promise<ClientOption[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: clients.id,
        nameEn: clients.nameEn,
        nameAr: clients.nameAr,
        city: clients.city,
        country: clients.country,
      })
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
