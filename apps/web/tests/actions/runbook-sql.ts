// The SQL blocks of the owner runbooks under docs/db-steps/, read by the dbtests
// so what the owner pastes is exactly what the tests ran. Not a test file.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const RUNBOOK_0059_FILE = 'docs/db-steps/0059-round-d.md';
const RUNBOOK_0060_FILE = 'docs/db-steps/0060-round-e.md';

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

/** Which runbook file holds the block that starts with each first line. */
const RUNBOOK_FILE_BY_FIRST_LINE: Record<string, string> = {
  [RUNBOOK_0059.violators]: RUNBOOK_0059_FILE,
  [RUNBOOK_0059.restore]: RUNBOOK_0059_FILE,
  [RUNBOOK_0060.violators]: RUNBOOK_0060_FILE,
  [RUNBOOK_0060.restore]: RUNBOOK_0060_FILE,
};

/** The fenced ```sql block of its step runbook whose first line is `firstLine`. */
export function runbookSql(firstLine: string): string {
  const file = RUNBOOK_FILE_BY_FIRST_LINE[firstLine];
  if (file === undefined) throw new Error(`no runbook file is registered for the sql block "${firstLine}"`);
  const runbook = readFileSync(resolve(repo, file), 'utf8').replace(/\r\n/g, '\n');
  const start = runbook.indexOf(`\`\`\`sql\n${firstLine}\n`);
  if (start === -1) throw new Error(`${file} has no sql block starting "${firstLine}"`);
  const body = start + '```sql\n'.length;
  return runbook.slice(body, runbook.indexOf('```', body));
}

/** A migration's SQL text, as the migrator reads it. */
export function migrationSql(tag: string): string {
  return readFileSync(resolve(repo, `packages/db/migrations/${tag}.sql`), 'utf8');
}
