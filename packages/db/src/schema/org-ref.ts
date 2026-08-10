// Composite same-org foreign-key helpers (P1-prep). LEAF module — imports
// nothing from ./schema, so it never participates in the schema import cycle.
//
// A child row references a parent WITHIN the same org via a composite FK
// (org_id, <name>_id) -> parent(org_id, id). Because the target's universal
// unique(org_id, id) is the referenced key, a cross-org reference is impossible
// at the database. Ships an (org_id, <name>_id) index (org_id leads).
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
 */
export function sameOrgFk(
  t: Record<string, AnyPgColumn>,
  name: string,
  target: SameOrgTarget,
  opts?: { onDelete?: OnDelete },
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
    index(`${table}_${name}_idx`).on(t.orgId, child),
  ];
}
