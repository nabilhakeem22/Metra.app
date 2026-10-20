import 'server-only';
// What the measured provisional lines add to the final account, summed in ONE
// SQL aggregate (A3 reliability R3): the delivery card and the final account's
// issue core need one figure, so no measured line crosses the wire and its
// cost does not grow with them, nor with the readings behind them (each line's
// latest is one index probe, ./measured-lines.ts, A5 R3).
//
// It mirrors computeFinalAccount (money/final-account.ts) line for line, the
// final account page's per-line rule (A5):
//   - only a PROVISIONAL line is billed by measurement (decision D2a);
//   - its FINAL measured quantity is the latest RECORDED reading (`seq desc`, A12);
//   - residual = measured - contract qty - Σ approved change-order qty on it;
//   - works = round(residual x unit price, 4), less round(that x line discount
//     x 0.01, 4): numeric multiplication is exact, and round() on numeric is
//     half away from zero, the money engine's rule;
//   - the contract's document discount, VAT and supervision follow in TS
//     (finalAccountBalance), on the sum.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { measuredLinesOf, measuredWorksOf } from './measured-lines';

export async function loadMeasuredWorks(tx: MetraDb, contractId: string): Promise<string> {
  const rows = (await tx.execute(measuredWorksOf(measuredLinesOf(contractId, sql`l.provisional`)))) as unknown as Array<{ works: string }>;
  return rows[0].works;
}
