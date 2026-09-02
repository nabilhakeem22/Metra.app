// Design-Engagement Machine, Step 4 — the manual finance ledger. `recordPayment`
// appends ONE row to the append-only `payment_events` table (SELECT + INSERT
// grants only at the DB). There is NO gateway: a recorded payment is a CLEARED
// payment, so `cleared_at` defaults to now(). Money is validated with exact
// scale-4 BigInt (never parseFloat). The engagement is verified in-org (RLS
// scopes the read) before the insert, so a caller cannot record against a
// foreign engagement.
import {
  PAYMENT_EVENT_KINDS,
  designEngagements,
  paymentEvents,
  type PaymentEventKind,
} from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { MONEY_RE, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from './states';
import { isUuid } from '@/lib/uuid';

const KIND_SET = new Set<string>(PAYMENT_EVENT_KINDS);

export interface RecordPaymentInput {
  engagementId: string;
  kind: PaymentEventKind;
  amount: string;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  /**
   * Optional client-supplied idempotency key (UUID). Absent/empty -> a plain
   * append. A present, well-formed key dedups a retried recording via the partial
   * unique index: the first write wins, a replay returns the SAME payment id with
   * `already: true` and records no second row / no second audit. A present but
   * non-UUID key is rejected with a coded `invalid`.
   */
  idempotencyKey?: string | null;
}

/** Trim a nullable free-text field to a stored value ('' / whitespace -> null). */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Record a cleared payment against an engagement (append-only). Gated on the
 * `engagements_finance` capability (create). Flow: validate the kind + a
 * well-formed positive scale-4 money `amount` (else a coded error); open the RLS
 * tx; assert the engagement resolves in-org (`engagement_not_found` if
 * absent/foreign); insert one `payment_events` row with `cleared_at = now()` and
 * `recorded_by = ctx.userId`. Returns the new payment id. Never throws to the
 * client — coded ActionResult only.
 */
export async function recordPaymentCore(
  ctx: OrgContext,
  input: RecordPaymentInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  if (typeof input.kind !== 'string' || !KIND_SET.has(input.kind)) {
    return { ok: false, error: 'invalid' };
  }
  if (typeof input.amount !== 'string' || !MONEY_RE.test(input.amount.trim())) {
    return { ok: false, error: 'payment_amount_invalid' };
  }
  const amount4 = parseMoney4(input.amount);
  if (amount4 <= 0n) {
    return { ok: false, error: 'payment_amount_invalid' };
  }
  // Persist the canonical scale-4 value so the STORED amount is exactly the one
  // the app validated (and the depositCleared guard later trusts) — the DB
  // numeric(18,4) would otherwise round a >4-decimal input up past what we OK'd.
  const amount = formatMoney4(amount4);

  // Normalise the idempotency key: trim; empty/whitespace/undefined -> null (a
  // plain append). A present-but-malformed key is a coded 'invalid'.
  const trimmedKey = input.idempotencyKey?.trim();
  const idempotencyKey = trimmedKey ? trimmedKey : null;
  if (idempotencyKey !== null && !isUuid(idempotencyKey)) {
    return { ok: false, error: 'invalid' };
  }

  const method = optionalText(input.method);
  const reference = optionalText(input.reference);
  const note = optionalText(input.note);

  // Set inside the tx when a keyed insert loses the ON CONFLICT race (or replays
  // its own earlier write): the existing row is returned, no second row/audit.
  let already = false;

  const result = await mutateInOrg(
    ctx,
    { capability: 'engagements_finance', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, input.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      // No recording a payment against a finished engagement (abandoned / closed).
      if (isTerminal(engagement.state)) fail('engagement_not_active');

      // KEYED PATH — dedup via the partial unique arbiter (first-write-wins).
      // ON CONFLICT DO NOTHING (not a raised unique violation) so the surrounding
      // withOrgContext transaction is never aborted — the codebase's established
      // idempotency idiom (mirrors claimPeriod). This preserves append-only:
      // never an UPDATE, so a replay keeps the ORIGINAL amount (first-write-wins).
      if (idempotencyKey !== null) {
        const inserted = await tx
          .insert(paymentEvents)
          .values({
            orgId: ctx.orgId,
            engagementId: input.engagementId,
            kind: input.kind,
            amount,
            method,
            reference,
            recordedBy: ctx.userId,
            note,
            idempotencyKey,
          })
          .onConflictDoNothing({
            // For onConflictDoNothing, `where` is the ARBITER predicate — it
            // renders `ON CONFLICT (org_id, engagement_id, idempotency_key)
            // WHERE idempotency_key is not null DO NOTHING`, matching the partial
            // unique index exactly (targetWhere is a doUpdate-only option).
            target: [
              paymentEvents.orgId,
              paymentEvents.engagementId,
              paymentEvents.idempotencyKey,
            ],
            where: sql`idempotency_key is not null`,
          })
          .returning({ id: paymentEvents.id });

        if (inserted.length > 0) {
          await audit({
            entity: 'design_engagement',
            entityId: input.engagementId,
            action: 'create',
            before: null,
            after: { payment_id: inserted[0].id, kind: input.kind, amount },
          });
          return inserted[0].id;
        }

        // Lost the race / replay: return the winning row's id, no second audit.
        const [existing] = await tx
          .select({ id: paymentEvents.id })
          .from(paymentEvents)
          .where(
            and(
              eq(paymentEvents.orgId, ctx.orgId),
              eq(paymentEvents.engagementId, input.engagementId),
              eq(paymentEvents.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        already = true;
        return existing.id;
      }

      // KEYLESS PATH — byte-identical to the original plain append.
      const [row] = await tx
        .insert(paymentEvents)
        .values({
          orgId: ctx.orgId,
          engagementId: input.engagementId,
          kind: input.kind,
          amount,
          method,
          reference,
          recordedBy: ctx.userId,
          note,
        })
        .returning({ id: paymentEvents.id });

      await audit({
        entity: 'design_engagement',
        entityId: input.engagementId,
        action: 'create',
        before: null,
        after: { payment_id: row.id, kind: input.kind, amount },
      });
      return row.id;
    },
  );

  return result.ok ? { ...result, already } : result;
}
