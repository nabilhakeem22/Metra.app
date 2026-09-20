import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { documentCategories } from './document-categories';
import { organizations } from './organizations';
import { sameOrgFk } from './org-ref';
import { orgScoped } from './org-scoped';

/**
 * Metadata for objects in the private `metra-files` bucket. `object_key` is
 * always `{org_id}/{entity}/{uuid}` so storage RLS can key on the path prefix.
 */
export const files = pgTable(
  'files',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    bucket: text('bucket').notNull().default('metra-files'),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    originalName: text('original_name'),
    // The firm's filing category (document_categories). NULLABLE: every file that
    // predates categories keeps working and simply shows as uncategorised, and a
    // category that is later removed sets this back to null rather than orphaning
    // the file.
    categoryId: uuid('category_id'),
    createdBy: uuid('created_by'),
  },
  (t) => [
    unique('files_org_id_id_unique').on(t.orgId, t.id),
    unique('files_object_key_unique').on(t.objectKey),
    // The ONLY way this table is ever read: "the documents on this client /
    // project / engagement". Without it that is a full scan of every file in
    // the database, filtered afterwards.
    index('files_org_entity_idx').on(t.orgId, t.entity, t.entityId),
    // `files_category_same_org_fk` — (org_id, category_id) -> document_categories
    // (org_id, id), ON DELETE SET NULL. 0040 hand-wrote it in exactly this shape
    // WITHOUT going through `sameOrgFk`, so for thirteen migrations every database
    // held a composite set-null FK that no schema file declared: absent from the
    // drizzle snapshot, absent from `declaredConstraints()`, and invisible to
    // `assert-schema-applied`, which is one-directional by design. It was found by
    // 0052's own straggler check failing CI, not by a reader. Declaring it here is
    // what moves the floor in `declaredCompositeSetNullFks()` from eleven to
    // twelve, so a future `drizzle-kit generate` that dropped its narrowing would
    // now be seen.
    //
    // `index: false` because this is a DECLARATION OF WHAT EXISTS, not a request
    // for new DDL: the helper would otherwise emit `files_category_idx`, which no
    // database has, and the partial `files_org_category_idx` below already answers
    // every query that leads with (org_id, category_id). No migration is implied
    // by this line.
    ...sameOrgFk(t, 'category', documentCategories, {
      onDelete: 'set null',
      index: false,
    }),
    // Live in the database since 0040 (filing by document category). PARTIAL:
    // category_id is null for every uncategorised file, and those are never the
    // rows this index is asked for. Declared here so a future `drizzle-kit
    // generate` sees it instead of emitting a DROP INDEX for it.
    index('files_org_category_idx')
      .on(t.orgId, t.categoryId)
      .where(sql`category_id is not null`),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
