// `market:withdraw`: one guarded UPDATE. A withdrawn bulletin stays on file
// (provenance), but RLS stops showing it and the effective price of every
// month it reported falls back to the previous published bulletin.
import type { PostgresJs } from '../db/connection';

export async function withdrawBulletin(sql: PostgresJs, period: string, reason: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    update market_bulletins
       set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = ${reason}
     where publisher = 'mhuc_cabm' and period_month = ${`${period}-01`} and status = 'published'
     returning id`;
  if (rows.length === 0) throw new Error(`no published bulletin for ${period}; nothing was withdrawn`);
  return rows[0].id;
}
