// Applies roles + RLS policies + trigger functions. Run AFTER migrate.
// Order matters: functions -> roles (grants execute on the function) -> policies.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSql } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const rlsDir = resolve(here, '../rls');
const files = ['functions.sql', 'roles.sql', 'policies.sql'];

async function main() {
  const sql = createSql(MIGRATION_DATABASE_URL(), { max: 1, prepare: false });
  try {
    for (const file of files) {
      const path = resolve(rlsDir, file);
      const content = readFileSync(path, 'utf8');
      console.log(`Applying ${file} ...`);
      await sql.unsafe(content);
    }
    console.log('RLS, roles and functions applied.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('apply-rls failed:', err.message);
  process.exit(1);
});
