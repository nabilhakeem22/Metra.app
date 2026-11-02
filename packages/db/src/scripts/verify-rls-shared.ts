// What every verify-rls-* read-back shares: the connection handle and the path
// of the roles.sql it compares against.
//
// ROLES_SQL resolves from THIS file's URL, so this module must stay in
// `scripts/`, next to the files that read it.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { createSql } from '../client';

export type Sql = ReturnType<typeof createSql>;

export const ROLES_SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../rls/roles.sql');
