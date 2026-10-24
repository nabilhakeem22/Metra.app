// Composite same-org foreign-key helpers (P1-prep). LEAF module — imports
// nothing from ./schema, so it never participates in the schema import cycle.
//
// A child row references a parent WITHIN the same org via a composite FK
// (org_id, <name>_id) -> parent(org_id, id). Because the target's universal
// unique(org_id, id) is the referenced key, a cross-org reference is impossible
// at the database. Ships an (org_id, <name>_id) index (org_id leads) unless the
// table already declares a wider index under that exact name - see `index: false`.
import { getTableName } from 'drizzle-orm';
import { foreignKey, index, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** `{ <name>Id: uuid('<name>_id') }` (nullable; caller adds .notNull()). */
export function sameOrgRef<N extends string>(name: N) {
  return {
    [`${name}Id`]: uuid(`${name}_id`),
  } as { [K in `${N}Id`]: ReturnType<typeof uuid> };
}

export interface SameOrgTarget {
  orgId: AnyPgColumn;
  id: AnyPgColumn;
}

type OnDelete = 'restrict' | 'cascade' | 'set null' | 'no action' | 'set default';

/**
 * Composite same-org FK + index for a child column produced by sameOrgRef.
 * Spread the result into the table's config array. Precondition: `target` has
 * unique(org_id, id).
 *
 * `index: false` means ONE thing: **this table already declares a wider index
 * under the exact name this helper would generate, with the same leading
 * columns, so the generated one would be a duplicate NAME rather than an extra
 * index.** It is not a way to skip an index that should exist. `drizzle-kit
 * generate` refuses to run at all on a duplicated index name - it aborts before
 * writing anything - so the collision is not cosmetic: it makes the one command
 * that authors a migration unusable.
 *
 * `onDelete: 'set null'` HERE IS NOT WHAT THE DATABASE HOLDS, and the gap is
 * deliberate. Postgres's bare `ON DELETE SET NULL` nulls EVERY referencing
 * column, and on a composite `(org_id, <name>_id)` that includes `org_id`, which
 * is `not null` on every org-scoped table - so the parent delete was refused
 * outright (23502, or MT100 under an immutability trigger), for all eleven
 * set-null constraints this helper emits - and for a twelfth,
 * `files_category_same_org_fk`, which 0040 hand-wrote in the same shape without
 * going through this helper at all. The correct action is
 * `ON DELETE SET NULL (<name>_id)`, which PostgreSQL 15+ supports and
 * **drizzle-orm 0.36 cannot express**: `foreignKey().onDelete()` takes an action
 * and no column list, and snapshot format v7 has no field for one.
 *
 * So from `migrations/0052_composite_fk_set_null_columns.sql` onward those
 * constraints carry the COLUMN LIST in the database while this file keeps
 * emitting the bare action - which is what keeps `db:assert-snapshot` green (the
 * schema and the snapshot still agree on the ACTION, and that is all either of
 * them records). CONSEQUENCE FOR THE NEXT PERSON: a NEW `set null` composite FK
 * added through this helper is BORN WITH THE DEFECT and must be narrowed by its
 * own migration. 0052's straggler check is what refuses to let one through
 * unnoticed.
 */
export function sameOrgFk(
  t: Record<string, AnyPgColumn>,
  name: string,
  target: SameOrgTarget,
  opts?: { onDelete?: OnDelete; index?: boolean },
) {
  const child = t[`${name}Id`];
  const table = getTableName(
    (t.orgId as unknown as { table: Parameters<typeof getTableName>[0] }).table,
  );
  return [
    foreignKey({
      columns: [t.orgId, child],
      foreignColumns: [target.orgId, target.id],
      name: `${table}_${name}_same_org_fk`,
    }).onDelete(opts?.onDelete ?? 'restrict'),
    ...(opts?.index === false
      ? []
      : [index(`${table}_${name}_idx`).on(t.orgId, child)]),
  ];
}

export interface SameContractTarget {
  orgId: AnyPgColumn;
  contractId: AnyPgColumn;
  id: AnyPgColumn;
}

export interface SameProjectTarget {
  orgId: AnyPgColumn;
  projectId: AnyPgColumn;
  id: AnyPgColumn;
}

/**
 * The 3-column FK `(org_id, <scope>_id, <name>_id) -> target(org_id, <scope>_id, id)`:
 * a child that names a row inside a scope (a contract, a project) can only name
 * a row of ITS OWN scope, as a database fact. Precondition: `target` has
 * unique(org_id, <scope>_id, id). NO index is emitted: every caller declares
 * the index its reads need. A nullable `<name>_id` is unchecked while null
 * (MATCH SIMPLE), which is what an optional target means. Never `set null`: it
 * would null the scope column too (the 0052 defect, one column wider).
 */
function sameScopeFk(
  t: Record<string, AnyPgColumn>,
  scope: 'contract' | 'project',
  name: string,
  targetScopeColumn: AnyPgColumn,
  target: { orgId: AnyPgColumn; id: AnyPgColumn },
  onDelete: 'restrict' | 'cascade',
) {
  const table = getTableName(
    (t.orgId as unknown as { table: Parameters<typeof getTableName>[0] }).table,
  );
  return foreignKey({
    columns: [t.orgId, t[`${scope}Id`], t[`${name}Id`]],
    foreignColumns: [target.orgId, targetScopeColumn, target.id],
    name: `${table}_${name}_same_${scope}_fk`,
  }).onDelete(onDelete);
}

/**
 * `(org_id, contract_id, <name>_id) -> target(org_id, contract_id, id)` (Stage 2,
 * 0063): a line, a section, a payment request of THIS contract. RESTRICT by
 * default; `cascade` only where the child is part of its parent (a contract
 * line of its section).
 */
export function sameContractFk(
  t: Record<string, AnyPgColumn>,
  name: string,
  target: SameContractTarget,
  opts?: { onDelete?: 'restrict' | 'cascade' },
) {
  return sameScopeFk(t, 'contract', name, target.contractId, target, opts?.onDelete ?? 'restrict');
}

/**
 * `(org_id, project_id, <name>_id) -> target(org_id, project_id, id)` (Stage 3,
 * 0064): a site visit, an execution contract of THIS project. Always RESTRICT:
 * a diary row is evidence and is never removed with its parent.
 */
export function sameProjectFk(
  t: Record<string, AnyPgColumn>,
  name: string,
  target: SameProjectTarget,
) {
  return sameScopeFk(t, 'project', name, target.projectId, target, 'restrict');
}
