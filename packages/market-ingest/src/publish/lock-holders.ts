// What to tell the owner when a market write waited 3 s for a lock (55P03):
// who holds the market locks, for how long, and the line that ends a stuck one.
import { withDatabase } from '../db/connection';

interface Holder {
  pid: number;
  state: string | null;
  age_seconds: number | null;
}

export async function describeLockHolders(): Promise<string> {
  const holders = await withDatabase((sql) => sql<Holder[]>`
    select distinct a.pid, a.state, extract(epoch from now() - a.xact_start)::integer as age_seconds
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
     where a.pid <> pg_backend_pid() and l.granted
       and (l.locktype = 'advisory'
            or l.relation in (select c.oid from pg_class c where c.relname like 'market\\_%'))
     order by age_seconds desc nulls last`);
  if (holders.length === 0) return 'No session holds a market lock now: run the command again.';
  const lines = holders.map(
    (holder) => `  pid ${holder.pid}, ${holder.state ?? 'unknown state'}, transaction open ${holder.age_seconds ?? '?'} s`,
  );
  return [
    'Another session holds the market locks (a publish or withdraw that is still running, or one left open by a dropped connection):',
    ...lines,
    'If it is a stuck market:publish or market:withdraw (open for minutes), end it in the SQL editor with: select pg_terminate_backend(<pid>);',
    'then run the command again. Otherwise wait for it to finish.',
  ].join('\n');
}
