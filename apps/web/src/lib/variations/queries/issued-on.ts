import 'server-only';
// The day a change order was issued to the client, in Cairo: the day of its
// `issued` event, or of the order itself for one issued before events were
// kept. Formatted IN SQL in Cairo, never on the Worker (UTC), as
// lib/contracts/queries/issued-on.ts does for a contract. A decision recorded
// on paper is refused before it.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

export async function variationIssuedOnInCairo(tx: MetraDb, variationOrderId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    select to_char(coalesce((
             select min(e.decided_at) from public.variation_order_events e
              where e.org_id = v.org_id and e.variation_order_id = v.id and e.kind = 'issued'
           ), v.created_at) at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day
      from public.variation_orders v
     where v.id = ${variationOrderId}
  `)) as unknown as Array<{ day: string }>;
  return rows[0].day;
}
