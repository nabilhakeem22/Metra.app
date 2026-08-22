import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { designEngagements } from './design-engagements';
import { engagementArtifactKind } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Engagement artifacts (Design-Engagement Machine, Step 5). One row per recorded
 * spatial/design artifact attested by a staff member — a measured `survey`, a
 * developer `autocad` set, and (in later steps) concept options, renders, shop
 * drawings and BOQs. Recording an artifact IS attesting it in this simple model,
 * so every row carries `attestedBy` + `attestedAt`. Unlike the append-only
 * ledgers, artifacts are re-attestable / relabellable (full-ish DML: SELECT +
 * INSERT + UPDATE in roles.sql). Cascade delete follows the parent engagement.
 *
 * The `spatialBaseReady` guard reads these rows: an Off-Plan engagement may
 * advance on an `autocad` OR `survey`; a non-Off-Plan engagement requires a
 * measured `survey`.
 */
export const engagementArtifacts = pgTable(
  'engagement_artifacts',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    kind: engagementArtifactKind('kind').notNull(),
    // A future link to the uploaded file. The upload flow is NOT wired this step,
    // so there is intentionally NO FK to `files` yet — this is a plain nullable
    // uuid for now, and the reference is added when the upload flow lands.
    fileId: uuid('file_id'),
    // For the manual render-manifest hashing that arrives in a later step.
    contentHash: text('content_hash'),
    // A human label, e.g. "Developer CAD set A".
    label: text('label'),
    attestedBy: uuid('attested_by').notNull(),
    attestedAt: timestamp('attested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text('note'),
  },
  (t) => [
    unique('engagement_artifacts_org_id_id_unique').on(t.orgId, t.id),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
    index('engagement_artifacts_org_engagement_kind_idx').on(
      t.orgId,
      t.engagementId,
      t.kind,
    ),
  ],
);

export type EngagementArtifact = typeof engagementArtifacts.$inferSelect;
export type NewEngagementArtifact = typeof engagementArtifacts.$inferInsert;
