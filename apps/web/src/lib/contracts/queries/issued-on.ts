import 'server-only';
// The day a contract was issued, in Cairo: the day of its `issued` event, or of
// the contract itself for one issued before events were kept. Formatted IN SQL
// in Cairo, never on the Worker (UTC), for the reason ./signing.ts gives. A
// paper signature (A3) and a payment received (A4 F5) are both refused before
// it.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

export async function contractIssuedOnInCairo(tx: MetraDb, contractId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    select to_char(coalesce((
             select min(e.decided_at) from public.contract_events e
              where e.contract_id = c.id and e.kind = 'issued'
           ), c.created_at) at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day
      from public.contracts c
     where c.id = ${contractId}
  `)) as unknown as Array<{ day: string }>;
  return rows[0].day;
}
