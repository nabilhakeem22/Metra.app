import 'server-only';
import type { MetraDb } from '@metra/db';
import { getTableColumns, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { LINE_INSERT_CHUNK } from './limits';

/**
 * Update rows by id in batches of {@link LINE_INSERT_CHUNK}: ONE
 * `update ... from (values ...)` per batch, setting `columns` (and `updated_at`)
 * from each row and matching `id` AND the `scope` column, so a row of another
 * parent is never touched whatever id it is given.
 *
 * Values travel as text and are cast to each column's own SQL type, so a figure
 * keeps the exact string the money engine produced. The batch size is the same
 * bind-parameter boundary `insertLinesInChunks` observes. An empty list issues no
 * statement.
 */
export async function updateRowsInChunks<Row extends { id: string }>(
  tx: MetraDb,
  table: PgTable,
  columns: readonly (keyof Row & string)[],
  rows: readonly Row[],
  scope: { column: PgColumn; value: string },
): Promise<void> {
  const tableColumns = getTableColumns(table) as Record<string, PgColumn>;
  const columnOf = (key: string): PgColumn => {
    const column = tableColumns[key];
    if (!column) throw new Error(`updateRowsInChunks: no column ${key}`);
    return column;
  };
  const names = ['id', ...columns].map((key) => sql.identifier(columnOf(key).name));
  const assignments = columns.map((key) => {
    const name = sql.identifier(columnOf(key).name);
    return sql`${name} = v.${name}::${sql.raw(columnOf(key).getSQLType())}`;
  });
  const asText = (value: unknown) => (value === null || value === undefined ? null : String(value));

  for (let start = 0; start < rows.length; start += LINE_INSERT_CHUNK) {
    const values = rows.slice(start, start + LINE_INSERT_CHUNK).map((row) => {
      const cells = [row.id, ...columns.map((key) => asText(row[key]))];
      return sql`(${sql.join(cells.map((cell) => sql`${cell}`), sql`, `)})`;
    });
    await tx.execute(sql`
      update ${table} as t
         set ${sql.join(assignments, sql`, `)}, updated_at = now()
        from (values ${sql.join(values, sql`, `)}) as v(${sql.join(names, sql`, `)})
       where t.id = v.id::uuid
         and t.${sql.identifier(scope.column.name)} = ${scope.value}::${sql.raw(scope.column.getSQLType())}`);
  }
}
