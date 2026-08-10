import {
  bigint,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
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
    createdBy: uuid('created_by'),
  },
  (t) => [
    unique('files_org_id_id_unique').on(t.orgId, t.id),
    unique('files_object_key_unique').on(t.objectKey),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;
