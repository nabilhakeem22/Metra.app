import 'server-only';
// What the measured provisional lines add to the final account, summed in ONE
// SQL aggregate (A3 reliability R3): the delivery card and the final account's
// issue core need one figure, so no measured line crosses the wire and its
// cost does not grow with them, nor with the readings behind them.
//
// The sum is `app_contract_measured_works` (packages/db rls/functions/
// 65-execution-facts.sql), which mirrors computeFinalAccount
// (money/final-account.ts) line for line; the contract's document discount,
// VAT and supervision follow in TS (finalAccountBalance), on the sum.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

export async function loadMeasuredWorks(tx: MetraDb, contractId: string): Promise<string> {
  const rows = (await tx.execute(sql`select public.app_contract_measured_works(${contractId}) as works`)) as unknown as Array<{
    works: string;
  }>;
  return rows[0].works;
}
