import { sql } from 'drizzle-orm';
import { check, numeric, text, timestamp } from 'drizzle-orm/pg-core';

// Org-agnostic helpers only. The org-scoped mixin (which references
// `organizations`) lives in ./org-scoped to avoid a circular import.

/** created_at / updated_at, timestamptz not null default now(). */
export function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  };
}

/**
 * Bilingual pair for a base name: `<base>_ar text`, `<base>_en text`. Pair the
 * columns with {@link bilingualCheck} for the "at least one non-null" constraint.
 */
export function bilingual<B extends string>(base: B) {
  return {
    [`${base}Ar`]: text(`${base}_ar`),
    [`${base}En`]: text(`${base}_en`),
  } as { [K in `${B}Ar` | `${B}En`]: ReturnType<typeof text> };
}

/**
 * Check constraint enforcing at least one of `<base>_ar` / `<base>_en` is a
 * NON-EMPTY (trimmed) value. §4.1: never render an empty cell — an empty string
 * must not satisfy "present", or a row can render blank in both locales.
 */
export function bilingualCheck(table: string, base: string) {
  return check(
    `${table}_${base}_present`,
    sql.raw(
      `length(btrim(coalesce("${base}_ar", ''))) > 0 or length(btrim(coalesce("${base}_en", ''))) > 0`,
    ),
  );
}

/** EGP money column: numeric(18,4). Drizzle carries this as string, never float. */
export function money(name: string) {
  return numeric(name, { precision: 18, scale: 4 });
}
