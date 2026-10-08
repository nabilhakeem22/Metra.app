'use server';

// The handover acknowledgement the studio records for its client. Split out of
// `lifecycle` (Round C): recording it now also closes the design-only delivery
// (../handover-close.ts), so it is no longer plain data entry.

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import type { RecordHandoffAcknowledgementInput } from '../handoff';
import { recordHandoffAndCloseCore } from '../handover-close';

/**
 * Server-action wrapper for {@link recordHandoffAndCloseCore}: resolves the
 * request's org context, appends one `handoff_acknowledgement` event (the staff
 * stand-in for the client's token ack), closes the delivery when it is at
 * `design_only_handoff`, and revalidates the shell on success. Returns the
 * ActionResult (the new event id in `data`, `closed` when the delivery closed)
 * — never throws to the client.
 */
export async function recordHandoffAcknowledgement(
  input: RecordHandoffAcknowledgementInput,
): Promise<ActionResult & { data?: string; closed?: boolean }> {
  const ctx = await requireOrg();
  const res = await recordHandoffAndCloseCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
