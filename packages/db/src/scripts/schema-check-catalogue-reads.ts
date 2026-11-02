// The catalogue reads `runSchemaCheck` compares `src/schema/` against: columns,
// index / constraint / function names, and the composite set-null foreign keys.
import type { CatalogueSql } from './schema-check';

/** One composite `ON DELETE SET NULL` foreign key, as the catalogue holds it. */
export interface CompositeSetNullFk {
  name: string;
  child: string;
  /** The columns the FK references with, `org_id` included. */
  fk_cols: string[];
  /** The columns it nulls on a parent delete. Empty means "all of them". */
  set_cols: string[];
}

/** Every table the DATABASE has in `public`, as table name -> column names. */
export async function appliedTables(sql: CatalogueSql): Promise<Map<string, Set<string>>> {
  const rows = (await sql`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
  `) as unknown as Array<{ table_name: string; column_name: string }>;
  const applied = new Map<string, Set<string>>();
  for (const row of rows) {
    const columns = applied.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    applied.set(row.table_name, columns);
  }
  return applied;
}

/** Every index / constraint / function name the DATABASE has in `public`. */
export async function appliedNames(
  sql: CatalogueSql,
  kind: 'index' | 'constraint' | 'function',
): Promise<Set<string>> {
  const rows = (await (kind === 'index'
    ? sql`select indexname as name from pg_indexes where schemaname = 'public'`
    : kind === 'constraint'
      ? sql`select c.conname as name
              from pg_constraint c
              join pg_namespace n on n.oid = c.connamespace
             where n.nspname = 'public'`
      : sql`select p.proname as name
              from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'`)) as unknown as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/**
 * Every composite FK in `public` whose ON DELETE action is SET NULL, with the
 * columns it nulls and the columns it references.
 *
 * `confdelsetcols` is the field 0052 writes, and the only thing in the catalogue
 * that can tell a NARROWED foreign key from a bare one. Until this section
 * existed, nothing on production asserted 0052 had done anything at all: the
 * constraint comparison above reads `conname` and a narrowing changes no name, so
 * step 3 of the deploy would print `constraints — 218 declared, 0 NOT FOUND` over
 * a catalogue where every one of the twelve still nulled `org_id` on a parent
 * delete (wave 7 R6). It is derived from the catalogue rather than from a list, so
 * a thirteenth such FK added by a future migration is checked without editing this
 * file. Requires PG15+; production and CI are 17.
 */
export async function compositeSetNullFks(sql: CatalogueSql): Promise<CompositeSetNullFk[]> {
  return (await sql`
    select c.conname   as name,
           rel.relname as child,
           coalesce(
             (select array_agg(a.attname order by a.attnum)
                from pg_attribute a
               where a.attrelid = c.conrelid and a.attnum = any(c.conkey)),
             '{}'::name[]
           ) as fk_cols,
           coalesce(
             (select array_agg(a.attname order by a.attnum)
                from pg_attribute a
               where a.attrelid = c.conrelid and a.attnum = any(c.confdelsetcols)),
             '{}'::name[]
           ) as set_cols
      from pg_constraint c
      join pg_class rel   on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'public'
       and c.contype = 'f'
       and c.confdeltype = 'n'
       and array_length(c.conkey, 1) > 1
     order by 1
  `) as unknown as CompositeSetNullFk[];
}
