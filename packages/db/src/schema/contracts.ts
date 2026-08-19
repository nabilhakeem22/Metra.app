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
import { contractStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projects } from './projects';
import { proposals } from './proposals';

/**
 * Contracts (عقود, P1 Slice 4). Generated from an ACCEPTED proposal: sections,
 * lines and totals are deep-copied at generation time and then frozen once the
 * contract leaves `draft` (enforce_immutable_when, SQLSTATE MT100). `number` is a
 * per-org int sequence rendered `C-YYYY-NNNN`.
 *
 * `originalValue` snapshots the accepted proposal total (immutable). The REVISED
 * contract value (original + Σ approved-VO netDeltas) is a COMPUTED aggregate
 * (lib/aggregates/contract-value.ts) and is deliberately NOT a stored column —
 * storing it would collide with the MT100 immutability lock (OWNER decision A3).
 * Retention/advance default to 0 (A4); staff set them per contract while draft.
 */
export const contracts = pgTable(
  'contracts',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    ...bilingual('title'),
    // One contract per accepted proposal (unique below).
    sourceProposalId: uuid('source_proposal_id').notNull(),
    clientId: uuid('client_id').notNull(),
    projectId: uuid('project_id').notNull(),
    status: contractStatus('status').notNull().default('draft'),
    currency: text('currency').notNull().default('EGP'),
    signatureDate: date('signature_date'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    // Retention held against progress (A4: default 0; [0,100] CHECK).
    retentionPct: money('retention_pct').notNull().default('0'),
    retentionReleaseTermsAr: text('retention_release_terms_ar'),
    retentionReleaseTermsEn: text('retention_release_terms_en'),
    // Advance payment (A4: default 0; [0,100] CHECK).
    advancePct: money('advance_pct').notNull().default('0'),
    advanceRecoveryMethod: text('advance_recovery_method')
      .notNull()
      .default('prorata'),
    paymentTermsDays: integer('payment_terms_days'),
    paymentScheduleMode: text('payment_schedule_mode')
      .notNull()
      .default('milestone'),
    penaltyAr: text('penalty_ar'),
    penaltyEn: text('penalty_en'),
    defectsLiabilityDays: integer('defects_liability_days'),
    scopeInclusionsAr: text('scope_inclusions_ar'),
    scopeInclusionsEn: text('scope_inclusions_en'),
    scopeExclusionsAr: text('scope_exclusions_ar'),
    scopeExclusionsEn: text('scope_exclusions_en'),
    termsAr: text('terms_ar'),
    termsEn: text('terms_en'),
    // The accepted proposal total (= document total), immutable snapshot.
    originalValue: money('original_value').notNull().default('0'),
    // Snapshot totals cache (rate + amount) deep-copied from the proposal.
    discountPct: money('discount_pct').notNull().default('0'),
    taxRate: money('tax_rate').notNull().default('14'),
    supervisionPct: money('supervision_pct').notNull().default('0'),
    subtotal: money('subtotal').notNull().default('0'),
    discountAmount: money('discount_amount').notNull().default('0'),
    taxableBase: money('taxable_base').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    supervisionAmount: money('supervision_amount').notNull().default('0'),
    totalCost: money('total_cost').notNull().default('0'),
    totalMargin: money('total_margin').notNull().default('0'),
    tokenHash: text('token_hash'),
    shareExpiresAt: timestamp('share_expires_at', { withTimezone: true }),
  },
  (t) => [
    unique('contracts_org_id_id_unique').on(t.orgId, t.id),
    unique('contracts_org_id_number_unique').on(t.orgId, t.number),
    // One contract per source proposal, per org.
    unique('contracts_org_id_source_proposal_unique').on(
      t.orgId,
      t.sourceProposalId,
    ),
    unique('contracts_token_hash_unique').on(t.tokenHash),
    bilingualCheck('contracts', 'title'),
    check(
      'contracts_end_after_start',
      sql`end_date is null or start_date is null or end_date >= start_date`,
    ),
    check(
      'contracts_retention_pct_range',
      sql`retention_pct >= 0 and retention_pct <= 100`,
    ),
    check(
      'contracts_advance_pct_range',
      sql`advance_pct >= 0 and advance_pct <= 100`,
    ),
    ...sameOrgFk(t, 'sourceProposal', proposals, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'client', clients, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'project', projects, { onDelete: 'restrict' }),
    index('contracts_org_status_idx').on(t.orgId, t.status),
    index('contracts_org_project_idx').on(t.orgId, t.projectId),
  ],
);

export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
