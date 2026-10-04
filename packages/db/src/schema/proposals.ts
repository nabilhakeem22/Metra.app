import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { clients } from './clients';
import { designEngagements } from './design-engagements';
import { proposalKind, proposalStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projects } from './projects';

/**
 * Proposals / quotations (عروض الأسعار, P1 Slice 3). Header for a full sectioned
 * quote. `number` is a per-org int sequence formatted `Q-YYYY-NNNN` at render.
 * All money caches (subtotal…totalMargin) are SERVER-written from the pure totals
 * engine — never trusted from the client. Locked once `status<>'draft'` by the
 * enforce_immutable_when trigger.
 *
 * `kind = 'boq'` is a design engagement's BOQ working copy (one per engagement):
 * built in the same editor, priced before VAT and supervision, never sent as an
 * offer. The CHECKs below hold it to `draft` with no share token, no VAT and no
 * supervision, so the quote lifecycle (send, accept, expire) can never reach it.
 */
export const proposals = pgTable(
  'proposals',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    ...bilingual('title'),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull(),
    status: proposalStatus('status').notNull().default('draft'),
    kind: proposalKind('kind').notNull().default('quote'),
    // Set iff kind = 'boq': the engagement this BOQ working copy belongs to.
    engagementId: uuid('engagement_id'),
    currency: text('currency').notNull().default('EGP'),
    issueDate: date('issue_date'),
    expiryDate: date('expiry_date'),
    discountPct: money('discount_pct').notNull().default('0'),
    taxRate: money('tax_rate').notNull().default('14'),
    // Supervision fee % (of the taxable base), charged after VAT and untaxed.
    supervisionPct: money('supervision_pct').notNull().default('0'),
    // Server-written totals cache (scale-4 money).
    subtotal: money('subtotal').notNull().default('0'),
    discountAmount: money('discount_amount').notNull().default('0'),
    taxableBase: money('taxable_base').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    supervisionAmount: money('supervision_amount').notNull().default('0'),
    total: money('total').notNull().default('0'),
    totalCost: money('total_cost').notNull().default('0'),
    totalMargin: money('total_margin').notNull().default('0'),
    notesAr: text('notes_ar'),
    notesEn: text('notes_en'),
    termsAr: text('terms_ar'),
    termsEn: text('terms_en'),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    tokenHash: text('token_hash'),
    shareExpiresAt: timestamp('share_expires_at', { withTimezone: true }),
  },
  (t) => [
    unique('proposals_org_id_id_unique').on(t.orgId, t.id),
    unique('proposals_org_id_number_unique').on(t.orgId, t.number),
    unique('proposals_token_hash_unique').on(t.tokenHash),
    // Not partial: quotes always carry a NULL engagement (CHECK below) and NULLs
    // are distinct, so this is "one BOQ proposal per engagement".
    unique('proposals_org_engagement_unique').on(t.orgId, t.engagementId),
    check('proposals_engagement_iff_boq', sql`(kind = 'boq') = (engagement_id IS NOT NULL)`),
    check(
      'proposals_boq_unpriced_draft',
      sql`kind = 'quote' OR (status = 'draft' AND token_hash IS NULL AND tax_rate = 0 AND supervision_pct = 0)`,
    ),
    bilingualCheck('proposals', 'title'),
    check(
      'proposals_expiry_after_issue',
      sql`expiry_date is null or issue_date is null or expiry_date >= issue_date`,
    ),
    check(
      'proposals_discount_pct_range',
      sql`discount_pct >= 0 and discount_pct <= 100`,
    ),
    check(
      'proposals_supervision_pct_range',
      sql`supervision_pct >= 0 and supervision_pct <= 100`,
    ),
    check('proposals_tax_rate_range', sql`tax_rate >= 0 and tax_rate <= 100`),
    ...sameOrgFk(t, 'client', clients, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'project', projects, { onDelete: 'restrict' }),
    // `index: false`: proposals_org_engagement_unique above is the index.
    ...sameOrgFk(t, 'engagement', designEngagements, {
      onDelete: 'cascade',
      index: false,
    }),
    // Self-reference: a superseding draft points at the proposal it replaced.
    ...sameOrgFk(
      t,
      'supersedes',
      { orgId: t.orgId, id: t.id },
      { onDelete: 'set null' },
    ),
    index('proposals_org_status_idx').on(t.orgId, t.status),
    index('proposals_org_project_idx').on(t.orgId, t.projectId),
    // Live since 0019 — the keyset covering index the list endpoints read in
    // order (created_at DESC, id DESC) within an org.
    index('proposals_org_created_id_idx').on(
      t.orgId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
);

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
