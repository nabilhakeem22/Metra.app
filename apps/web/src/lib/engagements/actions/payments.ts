'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  logPaymentAndAdvanceCore,
  type LogPaymentAndAdvanceInput,
} from '../pay-and-advance';
import { recordPaymentCore, type RecordPaymentInput } from '../payments';

/**
 * Server-action wrapper for {@link recordPaymentCore}: resolves the request's org
 * context, appends one cleared payment to the append-only ledger, and revalidates
 * the shell on success. Returns the ActionResult (with the new payment id in
 * `data`) — never throws to the client. This is the manual finance ledger; there
 * is no gateway.
 */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await recordPaymentCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for {@link logPaymentAndAdvanceCore} — the Hero's combined
 * "Log payment & advance" (Epic D, Slice 3). Resolves the org context, runs the
 * sequential core (record payment → advance), and revalidates the shell WHENEVER
 * the payment persisted (even if the advance guard still blocks), so the ledger +
 * re-checked gate preview refresh. Returns the transition's ActionResult (or the
 * payment error) — never throws to the client.
 */
export async function logPaymentAndAdvance(
  engagementId: string,
  input: LogPaymentAndAdvanceInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const { paymentRecorded, ...result } = await logPaymentAndAdvanceCore(
    ctx,
    engagementId,
    input,
  );
  if (paymentRecorded) revalidatePath('/', 'layout');
  return result;
}
