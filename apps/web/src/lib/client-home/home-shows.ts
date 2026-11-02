// What the client home is now, for the studio asking for it: one statement, so
// the client's email flag costs the Client page control and the issue no round
// trip of its own.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { clientHasEmailSql } from '@/lib/engagements/queries/client-has-email';

/**
 * The home must be at `execution` and show THIS contract (the one picker,
 * app_delivery_current_contract): an older contract of a project whose newer
 * BOQ stands in front of it has no home to send the client to. Answers whether
 * a signing code could reach the home's client.
 */
export async function requireHomeShows(
  tx: MetraDb,
  engagementId: string,
  contractId: string,
): Promise<{ clientHasEmail: boolean }> {
  const rows = (await tx.execute(
    sql`select de.state::text as state, public.app_delivery_current_contract(de.id, de.org_id) as contract_id,
               ${clientHasEmailSql(sql`de.org_id`, sql`de.client_id`)} as client_has_email
          from public.design_engagements de where de.id = ${engagementId}`,
  )) as unknown as Array<{ state: string; contract_id: string | null; client_has_email: boolean }>;
  const home = rows[0];
  if (home?.state !== 'execution' || home.contract_id !== contractId) fail('client_home_unavailable');
  return { clientHasEmail: home.client_has_email };
}
