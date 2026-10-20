import 'server-only';
// The final account card's on-demand reads, gated and checked before any SQL
// runs: the whole card (asked when the tab is shown, and again after an issue)
// and one more page of its measured differences. The card shows money, so it
// is the Payments tab's gate (`payments` read, studio roles only). The 'use
// server' wrappers in ./actions.ts add the session.
//
// The input is `unknown` ON PURPOSE (the read is directly invokable). A
// contract the caller cannot see, or that is not an execution contract,
// answers `record_not_found`.
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { maySeeBilling } from '../billing/access';
import { getFinalAccount, getFinalAccountDifferences, type FinalAccountDifferencesPage, type FinalAccountView } from './load';

function fieldOf(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}

function found<T>(value: T | null): ActionResult & { data?: T } {
  return value ? { ok: true, data: value } : err('record_not_found');
}

export async function loadFinalAccountCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: FinalAccountView }> {
  if (!maySeeBilling(ctx.role)) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  if (!isUuid(contractId)) return err('malformed');
  try {
    return found(await getFinalAccount(ctx, contractId));
  } catch (error) {
    return unexpectedFailure('final account read failed', error);
  }
}

export async function loadFinalAccountDifferencesCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: FinalAccountDifferencesPage }> {
  if (!maySeeBilling(ctx.role)) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const afterLineId = fieldOf(input, 'afterLineId');
  if (!isUuid(contractId) || !isUuid(afterLineId)) return err('malformed');
  try {
    return found(await getFinalAccountDifferences(ctx, contractId, afterLineId));
  } catch (error) {
    return unexpectedFailure('final account differences read failed', error);
  }
}
