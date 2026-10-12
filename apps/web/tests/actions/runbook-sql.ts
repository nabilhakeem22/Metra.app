// The SQL blocks of the docs/DEPLOY.md owner runbook, read by the dbtests so
// what the owner pastes is exactly what the tests ran. Not a test file.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The first lines of the 0059 runbook's blocks the dbtests run. */
export const RUNBOOK_0059 = {
  violators: '-- 0059 step 2 (b): the studios a tightened CHECK would refuse. Expect 0 rows.',
  restore: '-- 0059 undo: the three 0058 CHECKs back, as ONE statement.',
};

/** The first lines of the 0060 runbook's blocks the dbtests run. */
export const RUNBOOK_0060 = {
  violators: '-- 0060 step 2 (b): the studios a new CHECK would refuse. Expect 0 rows.',
  restore: '-- 0060 undo (3): the three 0059 CHECKs back, as ONE statement.',
};

/** The fenced ```sql block of docs/DEPLOY.md whose first line is `firstLine`. */
export function runbookSql(firstLine: string): string {
  const deploy = readFileSync(resolve(repo, 'docs/DEPLOY.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = deploy.indexOf(`\`\`\`sql\n${firstLine}\n`);
  if (start === -1) throw new Error(`docs/DEPLOY.md has no sql block starting "${firstLine}"`);
  const body = start + '```sql\n'.length;
  return deploy.slice(body, deploy.indexOf('```', body));
}

/** A migration's SQL text, as the migrator reads it. */
export function migrationSql(tag: string): string {
  return readFileSync(resolve(repo, `packages/db/migrations/${tag}.sql`), 'utf8');
}
