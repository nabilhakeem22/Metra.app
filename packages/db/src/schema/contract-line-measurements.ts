import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { money } from './_helpers';
import { contractLines } from './contract-lines';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameContractFk } from './org-ref';

/**
 * Site measurements (الحصر على الموقع) of an execution contract's lines (Stage
 * 2, 0063): an APPEND-ONLY ledger. A reading is the FINAL MEASURED QUANTITY of
 * one line, entered at handover (owner decision, Oct 19). The most recently
 * RECORDED reading wins: the highest `seq` (an identity, assigned at insert in
 * recording order; the index below), whatever its `measured_on`, so a
 * correction is a new reading. Not `created_at`: that is the transaction's
 * START time, so two readings of one transaction would tie and a long
 * transaction would sort before readings it committed after. The final account bills
 * a provisional line's measured difference and flags a firm one's (owner
 * decision D2a). Site progress (deliveries, photos, notes) is not this table:
 * that is Stage 3's site diary.
 *
 * The 3-column FK makes "this line belongs to THIS contract" a database fact.
 * APPEND-ONLY BY GRANT: SELECT + INSERT only in roles.sql.
 */
export const contractLineMeasurements = pgTable(
  'contract_line_measurements',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').notNull(),
    contractLineId: uuid('contract_line_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    measuredQty: money('measured_qty').notNull(),
    measuredOn: date('measured_on').notNull(),
    note: text('note'),
    recordedBy: uuid('recorded_by').notNull(),
    idempotencyKey: text('idempotency_key'),
  },
  (t) => [
    unique('contract_line_measurements_org_id_id_unique').on(t.orgId, t.id),
    check('contract_line_measurements_qty_nonneg', sql`measured_qty >= 0 and measured_qty <> 'NaN'`),
    check('contract_line_measurements_note_length', sql`char_length(note) <= 500`),
    sameContractFk(t, 'contractLine', contractLines),
    // The latest reading of a line: the first row of this index.
    index('contract_line_measurements_org_line_latest_idx').on(
      t.orgId,
      t.contractLineId,
      t.seq.desc(),
    ),
    index('contract_line_measurements_org_contract_idx').on(t.orgId, t.contractId),
    uniqueIndex('contract_line_measurements_idempotency_key_uniq')
      .on(t.orgId, t.contractId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
  ],
);

export type ContractLineMeasurement = typeof contractLineMeasurements.$inferSelect;
export type NewContractLineMeasurement = typeof contractLineMeasurements.$inferInsert;
