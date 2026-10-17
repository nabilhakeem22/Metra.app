// `npm run market:seed-price-books -- [--dry-run] [--org <id>]...`
// The owner's step that fills studio price books from the published market
// book. Exit 1 when any studio failed (the others are committed; a re-run
// retries the failed ones and creates nothing twice).
import { parseArgs } from 'node:util';
import { withDrizzle } from '../db/connection';
import { seedReport } from '../seed/report';
import { runSeed } from '../seed/run';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function seedCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { 'dry-run': { type: 'boolean' }, org: { type: 'string', multiple: true } },
    strict: true,
  });
  const orgIds = values.org ?? [];
  const malformed = orgIds.filter((id) => !UUID.test(id));
  if (malformed.length > 0) throw new Error(`--org takes an organization id (a uuid), not ${malformed.join(', ')}`);
  const dryRun = values['dry-run'] === true;
  const run = await withDrizzle((db, sql) => runSeed(db, sql, { dryRun, orgIds }));
  for (const line of seedReport(run, dryRun)) console.log(line);
  return run.outcomes.some((outcome) => outcome.status === 'failed') ? 1 : 0;
}
