import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

// TEST-ONLY. The table a column-write scan is about (./write-sites.ts): the
// name the app's code reaches it by, the name SQL knows it by, and how a
// drizzle property name becomes a column name.

export interface ColumnWriteTarget {
  /** The drizzle table object's exported name, as the schema barrel exports it. */
  tableExport: string;
  /** The table it maps to, as SQL names it. */
  tableSqlName: string;
  /** Property name (`revisionCount`) to column name (`revision_count`). */
  columnOf: ReadonlyMap<string, string>;
}

/** The scan target for one drizzle table, given the name it is exported under. */
export function columnWriteTarget(tableExport: string, table: PgTable): ColumnWriteTarget {
  return {
    tableExport,
    tableSqlName: getTableName(table),
    columnOf: new Map(Object.entries(getTableColumns(table)).map(([property, column]) => [property, column.name])),
  };
}
