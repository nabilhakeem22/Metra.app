// `npm run market:publish -- --period 2026-07 --approve <sha256> --reviewer "<name>" [--replace]`
import { parseArgs } from 'node:util';
import { withDatabase } from '../db/connection';
import { publishStaged } from '../publish/publish';
import { readApprovedStaged } from '../publish/staged-file';
import { periodPaths } from '../staging';
import { requirePeriod, requireText } from './options';

export async function publishCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { period: { type: 'string' }, approve: { type: 'string' }, reviewer: { type: 'string' }, replace: { type: 'boolean' } },
    strict: true,
  });
  const period = requirePeriod(values.period);
  const reviewer = requireText(values.reviewer, '--reviewer');
  const { staged, sha256 } = readApprovedStaged(periodPaths(period).staged, period, values.approve ?? '');
  const summary = await withDatabase((sql) => publishStaged(sql, staged, sha256, { reviewer, replace: values.replace === true }));
  console.log(`market:publish ${period} published as ${summary.bulletinId}${summary.replaced ? ' (the previous one is withdrawn as replaced)' : ''}`);
  console.log(`  categories ${summary.categories}, items created ${summary.itemsCreated}, items updated ${summary.itemsUpdated}, discontinued ${summary.discontinued}, observations ${summary.observations}`);
  return 0;
}
