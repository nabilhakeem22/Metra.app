// What to tell the owner when a market write waited 3 s for a lock (55P03):
// every session holding a market lock, read from pg_locks and
// pg_stat_activity, as ./lock-holder-report.ts words it.
import { withDatabase } from '../db/connection';
import { lockHolderReport, type LockHolder } from './lock-holder-report';

interface HolderRow {
  pid: number;
  application_name: string | null;
  state: string | null;
  transaction_seconds: number | null;
  state_seconds: number | null;
}

/** The sessions holding a market lock, the longest-held first (an idle one with no transaction counts from when it went idle). */
export async function readLockHolders(): Promise<LockHolder[]> {
  const rows = await withDatabase((sql) => sql<HolderRow[]>`
    select * from (
      select distinct a.pid, a.application_name, a.state,
             extract(epoch from now() - a.xact_start)::integer as transaction_seconds,
             extract(epoch from now() - a.state_change)::integer as state_seconds
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
       where a.pid <> pg_backend_pid() and l.granted
         and (l.locktype = 'advisory'
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
