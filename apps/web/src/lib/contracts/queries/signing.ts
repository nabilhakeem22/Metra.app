import 'server-only';
// When and how a contract was signed, from its own append-only events: the
// client's acknowledgement on /c or in the client home ('online', with the
// name the client typed, so the studio sees it: H6.2 functional F4) or the
// studio's record of a paper signature ('paper'). The day is formatted IN SQL
// in Cairo: a paper signature is stored at Cairo midnight, which is the
// evening before in UTC, so a Worker (UTC) formatting the timestamp would show
// the day before (A3 F4). The typed name is shown as signerNameOf reads it
// (one line, no bidi override, a letter in it): /c stored names raw (H6.2
// re-check N2), and one with nothing visible left reads as no name.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { signerNameOf } from '@/lib/client-home/signer-name';
import type { ContractSigning } from './detail-types';

export async function loadContractSigning(tx: MetraDb, contractId: string): Promise<ContractSigning | null> {
  const rows = (await tx.execute(sql`
    select to_char(e.decided_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as "on",
           case e.kind when 'acknowledged_offline' then 'paper' else 'online' end as via,
           case e.kind when 'acknowledged' then nullif(btrim(e.actor_name), '') end as "signerName"
      from public.contract_events e
     where e.contract_id = ${contractId} and e.kind in ('acknowledged', 'acknowledged_offline')
     order by e.decided_at desc, e.id desc
     limit 1
  `)) as unknown as ContractSigning[];
  const signing = rows[0];
  return signing ? { ...signing, signerName: signerNameOf(signing.signerName) } : null;
}
