import {
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { boqSource, boqStatus } from './enums';
import { clients } from './clients';
import { designEngagements } from './design-engagements';
import { files } from './files';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projects } from './projects';

/**
 * Bill of Quantities (مقايسة) — the priced schedule of construction works.
 *
 * It PRICES THE WORKS AND NOTHING ELSE: there is deliberately no tax rate and no
 * supervision percentage here, because those are added when the BOQ becomes an
 * execution contract. That is why the totals are three figures
 * (`total = subtotal - discountAmount`) where a proposal's are eight.
 *
 * EVERY BOQ HAS LINES. A studio can type them, pull them from the price book, or
 * fill the downloaded template and upload it — but an uploaded sheet is an INPUT
 * METHOD, not a second kind of BOQ. `sourceFileId` keeps that sheet attached for
 * provenance (it is what the client was actually sent) while the lines remain the
 * record. Nothing downstream branches on how the lines arrived, which is what
 * keeps remeasurement from having a second, untrackable code path.
 *
 * `number` is a per-org int sequence rendered `BQ-YYYY-NNNN`, allocated under the
 * same advisory lock as proposal and contract numbers.
 */
export const boqs = pgTable(
  'boqs',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    ...bilingual('title'),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull(),
    // Nullable: an execution-only project can carry a BOQ with no design
    // engagement behind it.
    engagementId: uuid('engagement_id'),
    status: boqStatus('status').notNull().default('draft'),
    // Provenance only — never a capability discriminator.
    source: boqSource('source').notNull().default('built'),
    // The spreadsheet or PDF the lines came from, if any.
    sourceFileId: uuid('source_file_id'),
    currency: text('currency').notNull().default('EGP'),
    issueDate: date('issue_date'),
    // Revision chain, following the proposal precedent.
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    notesAr: text('notes_ar'),
    notesEn: text('notes_en'),
    // Totals. Server-written; `total` = subtotal - discountAmount.
    discountPct: money('discount_pct').notNull().default('0'),
    subtotal: money('subtotal').notNull().default('0'),
    discountAmount: money('discount_amount').notNull().default('0'),
    total: money('total').notNull().default('0'),
    // Margin-gated caches. SERVER-written; never reach a client surface.
    totalCost: money('total_cost').notNull().default('0'),
    totalMargin: money('total_margin').notNull().default('0'),
  },
  (t) => [
    unique('boqs_org_id_id_unique').on(t.orgId, t.id),
    unique('boqs_org_id_number_unique').on(t.orgId, t.number),
    bilingualCheck('boqs', 'title'),
    ...sameOrgFk(t, 'client', clients, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'project', projects, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'set null' }),
    ...sameOrgFk(t, 'sourceFile', files, { onDelete: 'set null' }),
    index('boqs_org_project_idx').on(t.orgId, t.projectId),
    index('boqs_org_status_idx').on(t.orgId, t.status),
  ],
);

export type Boq = typeof boqs.$inferSelect;
export type NewBoq = typeof boqs.$inferInsert;
