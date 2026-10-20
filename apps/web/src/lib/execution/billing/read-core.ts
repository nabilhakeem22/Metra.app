import 'server-only';
// The Payments tab's on-demand reads, gated and checked before any SQL runs:
// the whole tab (asked when the tab is shown, and again after each change it
// makes) and one more page of the ledger. The 'use server' wrappers in
// ./actions.ts add the session.
//
// The input is `unknown` ON PURPOSE: what reaches a server action is whatever
// was serialised across the boundary. A contract the caller cannot see, or
// that is not an execution contract, answers `record_not_found`; a cursor this
// module did not write is `malformed`.
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { readPaymentsCursor, type ContractPaymentsPage } from '../payments/queries';
import { maySeeBilling } from './access';
import { getContractBilling, getContractPaymentsPage, type ContractBillingView } from './view';

function fieldOf(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}

function found<T>(value: T | null): ActionResult & { data?: T } {
  return value ? { ok: true, data: value } : err('record_not_found');
}

export async function loadContractBillingCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: ContractBillingView }> {
  if (!maySeeBilling(ctx.role)) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  if (!isUuid(contractId)) return err('malformed');
  try {
    return found(await getContractBilling(ctx, contractId));
  } catch (error) {
    return unexpectedFailure('contract billing failed', error);
  }
}

export async function loadContractPaymentsCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: ContractPaymentsPage }> {
  if (!maySeeBilling(ctx.role)) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const after = readPaymentsCursor(fieldOf(input, 'cursor'));
  if (!isUuid(contractId) || after === null) return err('malformed');
  try {
    return found(await getContractPaymentsPage(ctx, contractId, after));
  } catch (error) {
    return unexpectedFailure('contract payments page failed', error);
  }
}
