// What to tell the owner when a market write waited 3 s for a lock (55P03):
// every session holding a market lock, read from pg_locks and
// pg_stat_activity, as ./lock-holder-report.ts words it.
import { MARKET_WRITE_LOCK, STUDIO_SEED_LOCK } from '@metra/db/market-seed';
import { withDatabase } from '../db/connection';
import { lockHolderReport, type LockHolder } from './lock-holder-report';

interface HolderRow {
  pid: number;
  application_name: string | null;
  state: string | null;
  transaction_seconds: number | null;
  state_seconds: number | null;
}

/**
 * The sessions holding a market lock, the longest-held first (an idle one with
 * no transaction counts from when it went idle). A market lock is a lock on a
 * market_ table, or one of the two market advisory keys, and no other key
 * (the app's number allocators, other services), all IN THIS DATABASE:
 * pg_locks shows the whole server's, and another database's oids and keys
 * can coincide with ours. How pg_locks spells the two keys:
 *  - MARKET_WRITE_LOCK, one bigint key (hashtext's int4, sign-extended):
 *    objsubid 1, its high 32 bits in classid and its low 32 in objid;
 *  - STUDIO_SEED_LOCK, the two-key form (it, then the org): objsubid 2, the
 *    first key in classid as an unsigned 32-bit oid.
 */
async function readLockHolders(): Promise<LockHolder[]> {
  const rows = await withDatabase((sql) => sql<HolderRow[]>`
    select * from (
      select distinct a.pid, a.application_name, a.state,
             extract(epoch from now() - a.xact_start)::integer as transaction_seconds,
             extract(epoch from now() - a.state_change)::integer as state_seconds
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
       where a.pid <> pg_backend_pid() and l.granted
         and l.database = (select oid from pg_database where datname = current_database())
         and ((l.locktype = 'advisory'
               and ((l.objsubid = 1 and ((l.classid::bigint << 32) | l.objid::bigint) = hashtext(${MARKET_WRITE_LOCK})::bigint)
                 or (l.objsubid = 2 and l.classid::bigint = (hashtext(${STUDIO_SEED_LOCK})::bigint & 4294967295))))
              or l.relation in (select c.oid from pg_class c where c.relname like 'market\\_%'))
    ) holders
     order by coalesce(transaction_seconds, state_seconds) desc nulls last, pid`);
  return rows.map((row) => ({
    pid: row.pid,
    applicationName: row.application_name,
    state: row.state,
    transactionSeconds: row.transaction_seconds,
    stateSeconds: row.state_seconds,
  }));
}

export async function describeLockHolders(): Promise<string> {
  return lockHolderReport(await readLockHolders());
}
