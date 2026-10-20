// The cost entry writes (المصروفات, A15): record, edit and void an actual cost
// on an execution contract. An entry is never deleted (metra_app holds no
// DELETE on the table); a voided one stays listed and counts in no total.
// PURE cores: no next/*, no session. The 'use server' wrappers in ./actions
// delegate here; exercised directly by tests/actions/cost-entries.dbtest.ts.
import { contractCostEntries, type MetraDb } from '@metra/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ConstraintRefusal } from '@/lib/actions/mutation-failure';
import { err, type ActionResult } from '@/lib/actions/result';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { readCostEntry, type CleanCostEntry, type TypedCostEntry } from './input';
import { lockLiveEntry, requireCostableContract, requireTargets } from './targets';

export interface CreateCostEntryInput extends TypedCostEntry {
  contractId?: unknown;
  /** Required: a uuid the form mints once per entry, so a retried Save records one entry. */
  idempotencyKey?: unknown;
}

export interface UpdateCostEntryInput extends TypedCostEntry {
  id?: unknown;
}

/** What a write races into: a line or section gone from under it, a price-book item deleted meanwhile. */
const COST_ENTRY_REFUSALS: readonly ConstraintRefusal[] = [
  // A description of invisible characters only (a zero-width space) is blank to the table.
  { constraint: 'contract_cost_entries_description_present', field: 'description', error: { code: 'required' } },
  { constraint: 'contract_cost_entries_contractSection_same_contract_fk', code: 'line_not_in_contract' },
  { constraint: 'contract_cost_entries_contractLine_same_contract_fk', code: 'line_not_in_contract' },
  { constraint: 'contract_cost_entries_costItem_same_org_fk', field: 'costItemId', error: { code: 'no_longer_exists' } },
];

const entryId = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** An input no form can fail to send: an object (a null or a string is a forged call). */
const isObject = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null;

/**
 * Insert once per key: `ON CONFLICT DO NOTHING` on the partial idempotency
 * index (first write wins, the transaction is never aborted), then the winning
 * row's id. `already` means nothing was written.
 */
async function insertOnce(
  tx: MetraDb,
  ctx: OrgContext,
  contractId: string,
  entry: CleanCostEntry,
  idempotencyKey: string,
): Promise<{ id: string; already: boolean }> {
  const inserted = await tx
    .insert(contractCostEntries)
    .values({ orgId: ctx.orgId, contractId, ...entry, recordedBy: ctx.userId, idempotencyKey })
    .onConflictDoNothing({
      target: [contractCostEntries.orgId, contractCostEntries.contractId, contractCostEntries.idempotencyKey],
      where: sql`idempotency_key is not null`,
    })
    .returning({ id: contractCostEntries.id });
  if (inserted[0]) return { id: inserted[0].id, already: false };
  const [existing] = await tx
    .select({ id: contractCostEntries.id })
    .from(contractCostEntries)
    .where(and(eq(contractCostEntries.contractId, contractId), eq(contractCostEntries.idempotencyKey, idempotencyKey)))
    .limit(1);
  return { id: existing.id, already: true };
}

/**
 * Record a cost on an issued, signed or terminated execution contract, booked
 * to one of its lines, one of its sections, or the whole contract. A replayed
 * key answers `already: true` with the first entry's id and writes nothing.
 */
export async function createCostEntryCore(
  ctx: OrgContext,
  input: CreateCostEntryInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  if (!isObject(input)) return err('malformed');
  const contractId = entryId(input.contractId);
  const idempotencyKey = entryId(input.idempotencyKey);
  if (!isUuid(contractId) || !isUuid(idempotencyKey)) return err('malformed');
  const read = readCostEntry(input, todayInCairo(new Date()));
  if (!read.ok) return read.malformed ? err('malformed') : fieldsFailed(read.errors);
  const entry = read.values;

  let already = false;
  const result = await mutateInOrg(
    ctx,
    { capability: 'cost_entries', action: 'create', refusals: COST_ENTRY_REFUSALS },
    async (tx, audit) => {
      await requireCostableContract(tx, contractId);
      await requireTargets(tx, contractId, entry);
      const written = await insertOnce(tx, ctx, contractId, entry, idempotencyKey);
      already = written.already;
      if (!already) {
        await audit({ entity: 'contract_cost_entry', entityId: written.id, action: 'create', before: null, after: { contractId, ...entry } });
      }
      return written.id;
    },
  );
  return result.ok ? { ...result, already } : result;
}

/** Change a live entry; its contract stays. A voided one is `cost_entry_voided`. */
export async function updateCostEntryCore(ctx: OrgContext, input: UpdateCostEntryInput): Promise<ActionResult> {
  if (!isObject(input)) return err('malformed');
  const id = entryId(input.id);
  if (!isUuid(id)) return err('malformed');
  const read = readCostEntry(input, todayInCairo(new Date()));
  if (!read.ok) return read.malformed ? err('malformed') : fieldsFailed(read.errors);
  const entry = read.values;

  return mutateInOrg(
    ctx,
    { capability: 'cost_entries', action: 'update', refusals: COST_ENTRY_REFUSALS },
    async (tx, audit) => {
      const { voidedAt: _live, ...before } = await lockLiveEntry(tx, id);
      await requireTargets(tx, before.contractId, entry);
      await tx
        .update(contractCostEntries)
        .set({ ...entry, updatedAt: new Date() })
        .where(eq(contractCostEntries.id, id));
      await audit({ entity: 'contract_cost_entry', entityId: id, action: 'update', before, after: { contractId: before.contractId, ...entry } });
    },
  );
}

/**
 * Void a live entry: it stays listed and leaves every total. The `voided_at
 * is null` in the WHERE is the admission gate, so of two voids one wins and
 * the other answers `cost_entry_voided`.
 */
export async function voidCostEntryCore(ctx: OrgContext, input: { id?: unknown }): Promise<ActionResult> {
  if (!isObject(input)) return err('malformed');
  const id = entryId(input.id);
  if (!isUuid(id)) return err('malformed');

  return mutateInOrg(ctx, { capability: 'cost_entries', action: 'update' }, async (tx, audit) => {
    const [voided] = await tx
      .update(contractCostEntries)
      .set({ voidedAt: sql`now()`, voidedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(contractCostEntries.id, id), isNull(contractCostEntries.voidedAt)))
      .returning({ id: contractCostEntries.id });
    if (!voided) {
      const [kept] = await tx.select({ id: contractCostEntries.id }).from(contractCostEntries).where(eq(contractCostEntries.id, id)).limit(1);
      fail(kept ? 'cost_entry_voided' : 'cost_entry_not_found');
    }
    await audit({ entity: 'contract_cost_entry', entityId: id, action: 'update', before: { voided: false }, after: { voided: true } });
  });
}
