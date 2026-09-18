// Design-Engagement Machine, Step 4 — the manual finance ledger. `recordPayment`
// appends ONE row to the append-only `payment_events` table (SELECT + INSERT
// grants only at the DB). There is NO gateway: a recorded payment is a CLEARED
// payment, so `cleared_at` defaults to now(). Money is validated with exact
// scale-4 BigInt (never parseFloat). The engagement is verified in-org (RLS
// scopes the read) before the insert, so a caller cannot record against a
// foreign engagement.
//
// THREE NAMED STAGES, one file each, on the seam
// `proposals/core/draft-save-*.ts` already uses: `payment-input.ts` decides
// (no database), `payment-append.ts` writes (no decisions), and this file is the
// gate and the order. `recordPaymentCore` was 142 lines with all three inlined —
// over the 120 the wave-5 gate asked for, on the path three testers spent two
// waves failing to break.
import { designEngagements } from '@metra/db';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';
import { appendKeyedPayment, appendPayment, auditPayment } from './payment-append';
import { normalizePayment, type RawPaymentFields } from './payment-input';

export interface RecordPaymentInput extends RawPaymentFields {
  engagementId: string;
  /**
   * Optional client-supplied idempotency key (UUID). Absent/empty -> a plain
   * append. A present, well-formed key dedups a retried recording via the partial
   * unique index: the first write wins, a replay returns the SAME payment id with
   * `already: true` and records no second row / no second audit. A present but
   * non-UUID key is rejected with a coded `invalid`.
   */
  idempotencyKey?: string | null;
}

/**
 * Record a cleared payment against an engagement (append-only). Gated on the
 * `engagements_finance` capability (create). Flow: validate the kind + a
 * well-formed positive scale-4 money `amount` (else a coded error); open the RLS
 * tx; assert the engagement resolves in-org (`engagement_not_found` if
 * absent/foreign); insert one `payment_events` row with `cleared_at = now()` and
 * `recorded_by = ctx.userId`. Returns the new payment id. Never throws to the
 * client — coded ActionResult only.
 *
 * `already: true` means THE LEDGER WAS NOT APPENDED: a key the ledger already
 * carried was replayed and the ORIGINAL row's id came back. Both money controls
 * read it and say so now (backlog 18); for five waves nothing did.
 */
export async function recordPaymentCore(
  ctx: OrgContext,
  input: RecordPaymentInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  const clean = normalizePayment(input);
  if (!clean.ok) return { ok: false, error: clean.error };
  const payment = clean.value;

  // Set inside the tx when a keyed insert loses the ON CONFLICT race (or replays
  // its own earlier write): the existing row is returned, no second row/audit.
  let already = false;

  const result = await mutateInOrg(
    ctx,
    { capability: 'engagements_finance', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      const engagement = await requireInOrg(
        tx,
        designEngagements,
        input.engagementId,
        { id: designEngagements.id, state: designEngagements.state },
        'engagement_not_found',
      );
      // No recording a payment against a finished engagement (abandoned / closed).
      if (isTerminal(engagement.state)) fail('engagement_not_active');

      if (payment.idempotencyKey !== null) {
        const keyed = await appendKeyedPayment(
          tx,
          ctx,
          input.engagementId,
          payment,
          payment.idempotencyKey,
        );
        already = keyed.already;
        if (!keyed.already) {
          await auditPayment(audit, input.engagementId, keyed.id, payment);
        }
        return keyed.id;
      }

      const id = await appendPayment(tx, ctx, input.engagementId, payment);
      await auditPayment(audit, input.engagementId, id, payment);
      return id;
    },
  );

  return result.ok ? { ...result, already } : result;
}
