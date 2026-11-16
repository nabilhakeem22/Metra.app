import { describe, expect, it } from 'vitest';
import { parse } from './scan-sources';
import { writeSitesIn } from './write-sites';
import type { ColumnWriteTarget } from './write-target';

// The column-write scan, on fixtures. Its three callers run it over the real
// tree, where a rule that quietly stopped firing would only show as a count
// that did not move. Each case here is a way round the first, literal-search
// version that a wave 7 tester walked (R1, F3, M2, M3), kept so that moving
// the scan out of the test it was born in could not lose one.

const KEYS: ColumnWriteTarget = {
  tableExport: 'vaultKeys',
  tableSqlName: 'vault_keys',
  columnOf: new Map([
    ['label', 'label'],
    ['revokedAt', 'revoked_at'],
    ['createdBy', 'created_by'],
  ]),
};

const IMPORT = `import { vaultKeys, otherTable } from '@metra/db';\n`;

function columnsWritten(...sources: string[]): string[][] {
  const files = sources.map((text, index) => parse(`fixture-${String(index)}.ts`, text));
  return writeSitesIn(files, KEYS).map((site) => site.columns);
}

describe('the writes it reads', () => {
  it('reads a plain update, and reports where it is', () => {
    const sites = writeSitesIn([parse('lib/keys.ts', `${IMPORT}\nawait tx.update(vaultKeys).set({ revokedAt: now, label }).where(x);`)], KEYS);
    expect(sites).toEqual([{ where: 'lib/keys.ts:3', columns: ['revoked_at', 'label'] }]);
  });

  it.each([
    ['a local alias', `${IMPORT}const table = vaultKeys;\nconst again = table;\ntx.update(again).set({ createdBy });`],
    ['a space inside the call', `${IMPORT}tx.update( vaultKeys ).set({ createdBy });`],
    ['a namespace import', `import * as schema from '@metra/db';\ntx.update(schema.vaultKeys).set({ createdBy });`],
    ['a destructured export', `import * as schema from '@metra/db';\nconst { vaultKeys: keys } = schema;\ntx.update(keys).set({ createdBy });`],
    ['an import alias', `import { vaultKeys as keys } from '@metra/db';\ntx.update(keys).set({ 'createdBy': id });`],
    ['an upsert', `${IMPORT}tx.insert(vaultKeys).values(row).onConflictDoUpdate({ target: vaultKeys.id, set: { createdBy } });`],
  ])('sees the write through %s', (_name, source) => {
    expect(columnsWritten(source)).toEqual([['created_by']]);
  });

  it('follows a re-export alias from one file into the next', () => {
    const barrel = `import { vaultKeys } from '@metra/db';\nexport { vaultKeys as keysTable };`;
    const consumer = `import { keysTable } from './barrel';\ntx.update(keysTable).set({ createdBy });`;
    expect(columnsWritten(barrel, consumer)).toEqual([['created_by']]);
  });

  it('reads a producer annotated with the set-source type, through its aliases', () => {
    const source = `${IMPORT}const STAMPS: Record<string, () => PgUpdateSetSource<typeof vaultKeys>> = { revoke: () => ({ revokedAt: now }) };
const patch = STAMPS[kind]();\ntx.update(vaultKeys).set(patch);`;
    expect(columnsWritten(source)).toEqual([['revoked_at']]);
  });

  it('leaves alone a write to another table, a plain insert, and an update that is not a query', () => {
    const source = `${IMPORT}tx.update(otherTable).set({ createdBy });
tx.insert(vaultKeys).values(row).onConflictDoNothing();
createHash('sha256').update(bytes).digest('hex');`;
    expect(columnsWritten(source)).toEqual([]);
  });
});

describe('what it refuses to guess', () => {
  it.each([
    ['a spread in the set', `${IMPORT}tx.update(vaultKeys).set({ ...patch, label });`, 'spreads "...patch"'],
    ['a computed key in the set', `${IMPORT}tx.update(vaultKeys).set({ [column]: value });`, 'unreadable member'],
    ['a spread inside an annotated producer', `${IMPORT}const patch: PgUpdateSetSource<typeof vaultKeys> = { ...hidden, label };`, 'spreads "...hidden"'],
    ['a computed key inside an annotated producer', `${IMPORT}const patch: PgUpdateSetSource<typeof vaultKeys> = { [column]: value };`, 'computed key'],
    ['an annotated producer that names no column', `${IMPORT}const patch: PgUpdateSetSource<typeof vaultKeys> = build();`, 'names no vault_keys column'],
    ['a set that is not a literal and not an annotated producer', `${IMPORT}tx.update(vaultKeys).set(patch);`, 'does not resolve to a helper typed'],
    ['a key that is not a column', `${IMPORT}tx.update(vaultKeys).set({ nickname });`, 'not a column of vault_keys'],
    ['a table it cannot resolve', `${IMPORT}tx.update(tables[name]).set({ label });`, 'cannot resolve to a table'],
    ['an update of the table with no set in its chain', `${IMPORT}const pending = tx.update(vaultKeys);`, 'has no .set(…) in its chain'],
    ['an insert of the table whose builder is not followed', `${IMPORT}const pending = tx.insert(vaultKeys);`, 'has no readable builder'],
    ['an upsert whose set is not readable', `${IMPORT}tx.insert(vaultKeys).values(row).onConflictDoUpdate(options);`, 'is not an object literal'],
  ])('throws on %s', (_name, source, message) => {
    expect(() => columnsWritten(source)).toThrow(message);
  });

  it.each([
    ['a tagged template', 'await tx.execute(sql`update vault_keys set created_by = ${id}`);'],
    ['a statement built on one line and run on the next', `const statement = sql.raw('UPDATE public.vault_keys SET label = 1');\ndb.execute(statement);`],
    ['a quoted, schema-qualified name', `run('delete from "public"."vault_keys"');`],
    ['an insert', `run('insert into vault_keys (label) values (1)');`],
  ])('refuses raw SQL that writes the table: %s', (_name, source) => {
    expect(() => columnsWritten(source)).toThrow('raw SQL writes vault_keys');
  });

  it('lets raw SQL READ the table, and write another one', () => {
    const source = "run('select label from public.vault_keys');\nrun('update vault_keys_archive set label = 1');\nrun('holds UPDATE on the column vault_keys.label');";
    expect(columnsWritten(source)).toEqual([]);
  });
});
