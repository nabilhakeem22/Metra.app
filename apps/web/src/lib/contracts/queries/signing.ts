import 'server-only';
// When and how a contract was signed, from its own append-only events: the
// client's acknowledgement on /c ('online') or the studio's record of a paper
// signature ('paper'). The day is formatted IN SQL in Cairo: a paper signature
// is stored at Cairo midnight, which is the evening before in UTC, so a Worker
// (UTC) formatting the timestamp would show the day before (A3 F4).
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import type { ContractSigning } from './detail-types';

export async function loadContractSigning(tx: MetraDb, contractId: string): Promise<ContractSigning | null> {
  const rows = (await tx.execute(sql`
    select to_char(e.decided_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as "on",
           case e.kind when 'acknowledged_offline' then 'paper' else 'online' end as via
      from public.contract_events e
     where e.contract_id = ${contractId} and e.kind in ('acknowledged', 'acknowledged_offline')
     order by e.decided_at desc, e.id desc
     limit 1
  `)) as unknown as ContractSigning[];
  return rows[0] ?? null;
}
