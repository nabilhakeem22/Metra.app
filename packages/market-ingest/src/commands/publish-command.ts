// `npm run market:publish -- --period 2026-07 --approve <sha256> --reviewer "<name>" --pdf <path> [--md <path>] [--replace]`
import { parseArgs } from 'node:util';
import { withDatabase } from '../db/connection';
import { readGate, requireCleanGate } from '../gate';
import { requireApproveHash } from '../publish/approve';
import { withLockHolderReport } from '../publish/lock-report';
import { publishPeriod } from '../publish/publish';
import { requirePeriod, requireText } from './options';

export async function publishCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      period: { type: 'string' }, approve: { type: 'string' }, reviewer: { type: 'string' },
      replace: { type: 'boolean' }, pdf: { type: 'string' }, md: { type: 'string' },
    },
    strict: true,
  });
  const period = requirePeriod(values.period);
  const reviewer = requireText(values.reviewer, '--reviewer');
  const approve = requireApproveHash(values.approve);
  const gateCommit = requireCleanGate(readGate(), 'market:publish');
  const request = { period, approve, reviewer, replace: values.replace === true, pdfPath: values.pdf, mdPath: values.md, gateCommit };
  const summary = await withLockHolderReport(() => withDatabase((sql) => publishPeriod(sql, request)));
  console.log(`market:publish ${period} published as ${summary.bulletinId}${summary.replaced ? ' (the previous one is withdrawn as replaced)' : ''}`);
  console.log(`  categories ${summary.categories}, items created ${summary.itemsCreated}, items updated ${summary.itemsUpdated}, discontinued ${summary.discontinued}, observations ${summary.observations}`);
  console.log(`  gate commit ${gateCommit}`);
  return 0;
}
