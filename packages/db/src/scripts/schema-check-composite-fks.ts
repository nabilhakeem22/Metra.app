// The composite set-null foreign-key gate of `runSchemaCheck`: every such FK
// narrowed to one of its own non-`org_id` columns, and none missing.
import type { CompositeSetNullFk } from './schema-check-catalogue-reads';

/**
 * What is wrong with one narrowing, or nothing. A composite set-null FK must null
 * EXACTLY ONE column, that column must be its own referencing column, and it must
 * never be `org_id` — nulling the tenant key on a parent delete is the defect 0052
 * removed, and nulling some OTHER table's column is a hand-applied narrowing that
 * 0052's own idempotency branch would skip without looking (wave 7 S3).
 */
function narrowingProblem(fk: CompositeSetNullFk): string | undefined {
  const referencing = fk.fk_cols.filter((column) => column !== 'org_id');
  if (fk.set_cols.length === 0) return 'nulls EVERY referencing column, org_id included';
  if (fk.set_cols.length !== 1) {
    return `nulls ${fk.set_cols.join(', ')} — a narrowed FK nulls exactly one column`;
  }
  const [only] = fk.set_cols;
  if (only === 'org_id') return 'nulls org_id, which would strip the row of its tenant';
  if (!referencing.includes(only)) {
    return `nulls ${only}, which is not one of its own referencing columns (${referencing.join(', ')})`;
  }
  return undefined;
}

/** One report line per composite set-null FK that is not narrowed. */
function unnarrowedLines(compositeFks: CompositeSetNullFk[]): string[] {
  return compositeFks
    .map((fk) => ({ fk, problem: narrowingProblem(fk) }))
    .filter((checked) => checked.problem !== undefined)
    .map((checked) => `  - ${checked.fk.name} (on ${checked.fk.child}) ${checked.problem ?? ''}`);
}

/** The FAILING sentence for un-narrowed FKs, printed when there are any. */
function reportUnnarrowed(found: number, unnarrowed: string[]): void {
  console.error(
    `assert-schema-applied: composite set-null FKs — ${found} found, ` +
      `${unnarrowed.length} NOT NARROWED (this FAILS the check):\n${unnarrowed.join('\n')}\n\n` +
      'Migration 0052 narrows each of these to the one column it references. An ' +
      'un-narrowed composite SET NULL nulls EVERY referencing column on a parent ' +
      'delete, org_id included — the row keeps existing with no tenant.',
  );
}

/** The FAILING sentence for a database holding fewer such FKs than declared. */
function reportBehind(found: number, declaredCount: number): void {
  console.error(
    `assert-schema-applied: composite set-null FKs — only ${found} found and ` +
      `src/schema/ declares ${declaredCount} (this FAILS the check). Either this database ` +
      'is behind the code, or a composite ON DELETE SET NULL was re-created with a different ' +
      'referential action — which this section would otherwise report as nothing at all.',
  );
}

/**
 * Print the composite set-null FK section and return what gates the exit code.
 *
 * THE FLOOR, and the reason it is here: this section reports what the database
 * HAS, so an empty answer read "0 found, every one narrowed" and exited 0 — a
 * gate with no guard on the guard (wave 7 L3). The number is DERIVED from
 * `src/schema/` and never written down here: it read eleven while `files.ts`
 * declared no FK for `category_id`, and became twelve the moment that
 * declaration landed, with nothing in this file edited.
 *
 * A floor rather than an equality, still. `files_category_same_org_fk` is the
 * worked example of why: for thirteen migrations the database held a composite
 * set-null FK the code did not declare, and an equality would have failed this
 * check on every database rather than reporting it.
 */
export function reportCompositeSetNullFks(
  compositeFks: CompositeSetNullFk[],
  declaredCount: number,
): { unnarrowed: number; behind: boolean } {
  const unnarrowed = unnarrowedLines(compositeFks);
  const behind = compositeFks.length < declaredCount;
  if (unnarrowed.length === 0 && !behind) {
    console.log(
      `assert-schema-applied: composite set-null FKs — ${compositeFks.length} found ` +
        `(${declaredCount} declared in src/schema/), every one narrowed to a single ` +
        'non-org_id column.',
    );
  } else if (unnarrowed.length > 0) {
    reportUnnarrowed(compositeFks.length, unnarrowed);
  }
  if (behind) reportBehind(compositeFks.length, declaredCount);
  return { unnarrowed: unnarrowed.length, behind };
}
