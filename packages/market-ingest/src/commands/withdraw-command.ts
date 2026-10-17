// `npm run market:withdraw -- --period 2026-07 --reason "<text>"`
import { parseArgs } from 'node:util';
import { withDatabase } from '../db/connection';
import { withdrawBulletin } from '../publish/withdraw';
import { requirePeriod, requireText } from './options';

export async function withdrawCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { period: { type: 'string' }, reason: { type: 'string' } }, strict: true });
  const period = requirePeriod(values.period);
  const reason = requireText(values.reason, '--reason');
  const id = await withDatabase((sql) => withdrawBulletin(sql, period, reason));
  console.log(`market:withdraw ${period}: bulletin ${id} withdrawn ("${reason}"); its months fall back to the previous published bulletin`);
  return 0;
}
