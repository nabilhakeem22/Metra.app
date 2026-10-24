import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money } from './_helpers';
import { contractLines } from './contract-lines';
import { contracts } from './contracts';
import { marketUnit } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameContractFk, sameOrgFk, sameProjectFk } from './org-ref';
import { sitePhotos } from './site-photos';
import { siteVisits } from './site-visits';

/**
 * Materials delivered to site (Stage 3, 0064), recorded during a visit: what
 * arrived, how much, optionally which execution contract line it is for, and
 * optionally a photo of the delivery note. NOT a cost entry (turning one into a
 * cost is out of scope for v1).
 *
 * THE CONTRACT LINE IS A DATABASE FACT, TWICE: `contract_id` must be a contract
 * of the receipt's OWN project (org_id, project_id, contract_id), and
 * `contract_line_id` a line of THAT contract (org_id, contract_id,
 * contract_line_id). Both or neither (`site_material_receipts_contract_pair`).
 *
 * `photo_id` is `ON DELETE SET NULL (photo_id)` in the database (0064, the 0052
 * rule). EVIDENCE: `trg_site_material_receipts_guard` lets an UPDATE change
 * only the void pair (once). No DELETE grant.
 */
export const siteMaterialReceipts = pgTable(
  'site_material_receipts',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    clientKey: uuid('client_key').notNull(),
    recordedBy: uuid('recorded_by').notNull(),
    description: text('description').notNull(),
    qty: money('qty').notNull(),
    unit: marketUnit('unit').notNull(),
    contractId: uuid('contract_id'),
    contractLineId: uuid('contract_line_id'),
    supplier: text('supplier'),
    note: text('note'),
    photoId: uuid('photo_id'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
  },
  (t) => [
    unique('site_material_receipts_org_id_id_unique').on(t.orgId, t.id),
    unique('site_material_receipts_org_client_key_unique').on(t.orgId, t.clientKey),
    // Present = at least one visible character (the contract_cost_entries rule).
    check(
      'site_material_receipts_description_present',
      sql`description ~ '[^[:space:]\\u00a0\\u1680\\u2000-\\u200b\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]' and char_length(description) <= 200`,
    ),
    check('site_material_receipts_qty_positive', sql`qty > 0 and qty <> 'NaN'`),
    check(
      'site_material_receipts_contract_pair',
      sql`num_nonnulls(contract_id, contract_line_id) in (0, 2)`,
    ),
    check(
      'site_material_receipts_text_length',
      sql`char_length(supplier) <= 120 and char_length(note) <= 300`,
    ),
    check('site_material_receipts_void_pair', sql`(voided_at is null) = (voided_by is null)`),
    sameProjectFk(t, 'visit', siteVisits),
    sameProjectFk(t, 'contract', contracts),
    sameContractFk(t, 'contractLine', contractLines),
    ...sameOrgFk(t, 'photo', sitePhotos, { onDelete: 'set null' }),
    index('site_material_receipts_org_visit_idx').on(t.orgId, t.visitId),
    // A contract line delete (draft contracts only) checks the line FK; few rows link.
    index('site_material_receipts_org_contract_line_idx')
      .on(t.orgId, t.contractId, t.contractLineId)
      .where(sql`contract_line_id is not null`),
  ],
);

export type SiteMaterialReceipt = typeof siteMaterialReceipts.$inferSelect;
export type NewSiteMaterialReceipt = typeof siteMaterialReceipts.$inferInsert;
