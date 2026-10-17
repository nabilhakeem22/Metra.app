// Withdrawing a bulletin, in one transaction: the row stays on file
// (provenance) but RLS stops showing it; every month it reported falls back to
// the previous published bulletin; the items it discontinued are active again;
// and the details of every item it printed are re-derived from what is still
// published. `--replace` runs the same step on the bulletin it replaces.
import { applyMarketWriteTimeouts } from '@metra/db/lock-timeout';
import type { PostgresJs, Transaction } from '../db/connection';
import { refreshSeedBook } from '../seed/book-store';
import { refreshItemDetails } from './details';
import { MARKET_WRITE_LOCK } from './write-lock';

export async function withdrawInTransaction(tx: Transaction, bulletinId: string, reason: string): Promise<void> {
  const [row] = await tx<Array<{ discontinued_item_ids: string[] }>>`
    update market_bulletins
       set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = ${reason}
     where id = ${bulletinId} and status = 'published'
     returning discontinued_item_ids`;
  if (!row) throw new Error(`bulletin ${bulletinId} is not published; nothing was withdrawn`);
  if (row.discontinued_item_ids.length > 0) {
    await tx`update market_items set status = 'active', updated_at = now()
              where id = any(${row.discontinued_item_ids}::uuid[]) and status = 'discontinued'`;
  }
  const printed = await tx<Array<{ item_id: string }>>`select item_id from market_item_details where bulletin_id = ${bulletinId}`;
  await refreshItemDetails(tx, printed.map((item) => item.item_id));
}

export async function withdrawPeriod(sql: PostgresJs, period: string, reason: string): Promise<string> {
  await applyMarketWriteTimeouts(sql);
  return (await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
    const [current] = await tx<Array<{ id: string }>>`
      select id from market_bulletins where publisher = 'mhuc_cabm' and period_month = ${`${period}-01`} and status = 'published'`;
    if (!current) throw new Error(`no published bulletin for ${period}; nothing was withdrawn`);
    await withdrawInTransaction(tx, current.id, reason);
    await refreshSeedBook(tx);
    return current.id;
  })) as string;
}
