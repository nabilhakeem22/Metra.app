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
import { proposalStatus } from './enums';
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
    ...sameOrgFk(t, 'client', clients, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'project', projects, { onDelete: 'restrict' }),
    // Self-reference: a superseding draft points at the proposal it replaced.
    ...sameOrgFk(
      t,
      'supersedes',
      { orgId: t.orgId, id: t.id },
      { onDelete: 'set null' },
    ),
    index('proposals_org_status_idx').on(t.orgId, t.status),
    index('proposals_org_project_idx').on(t.orgId, t.projectId),
  ],
);

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
