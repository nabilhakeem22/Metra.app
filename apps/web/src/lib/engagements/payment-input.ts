// Stage 1 of recording a payment: everything decidable BEFORE the transaction
// opens. Nothing here touches a database, so a refusal has written nothing and
// taken no lock — and this file is unit-testable without one.
//
// Split out of `payments.ts` alongside `payment-append.ts`, the same
// validate / persist seam `proposals/core/draft-save-*.ts` and
// `variations/core/update-*.ts` already use: `recordPaymentCore` was 142 lines
// with all of it inlined, over the 120 the wave-5 gate asked for, on the path
// three testers spent two waves failing to break.
import { PAYMENT_EVENT_KINDS, type PaymentEventKind } from '@metra/db';
import type { ActionCode } from '@/lib/actions/result';
import { MONEY_RE, formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { NOT_UUID, optionalUuid } from '@/lib/uuid';
import {
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  TOO_LONG,
  optionalText,
} from '@/lib/validation/text';

const KIND_SET = new Set<string>(PAYMENT_EVENT_KINDS);

/**
 * The validated, canonical values the transaction writes. NOTHING here is the
 * request as typed: the amount has been re-formatted at scale 4 and every
 * optional text has been length-checked.
 */
export interface CleanPayment {
  kind: PaymentEventKind;
  /** Canonical scale-4. */
  amount: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  /** null means a PLAIN APPEND; a string means the dedup path. */
  idempotencyKey: string | null;
}

export interface RawPaymentFields {
  kind: PaymentEventKind;
  amount: string;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
}

export function normalizePayment(
  input: RawPaymentFields,
): { ok: true; value: CleanPayment } | { ok: false; error: ActionCode } {
  if (typeof input.kind !== 'string' || !KIND_SET.has(input.kind)) {
    return { ok: false, error: 'invalid' };
  }
  if (typeof input.amount !== 'string' || !MONEY_RE.test(input.amount.trim())) {
    return { ok: false, error: 'payment_amount_invalid' };
  }
  const amount4 = parseMoney4(input.amount);
  if (amount4 <= 0n) return { ok: false, error: 'payment_amount_invalid' };

  // Normalise the idempotency key: trim; empty/whitespace/undefined -> null (a
  // plain append). A present-but-malformed key is a coded 'invalid', and so is a
  // present-but-non-string one — see optionalUuid for why that is reachable.
  const idempotencyKey = optionalUuid(input.idempotencyKey);
  if (idempotencyKey === NOT_UUID) return { ok: false, error: 'invalid' };

  const method = optionalText(input.method, MAX_LABEL_CHARS);
  const reference = optionalText(input.reference, MAX_LABEL_CHARS);
  const note = optionalText(input.note, MAX_NOTE_CHARS);
  // An over-long field is a REFUSAL, not a truncation: a payment reference cut
  // at 200 characters is a reference that reconciles against nothing.
  if (method === TOO_LONG || reference === TOO_LONG || note === TOO_LONG) {
    return { ok: false, error: 'invalid' };
  }

  return {
    ok: true,
    value: {
      kind: input.kind,
      // Persist the canonical scale-4 value so the STORED amount is exactly the
      // one the app validated (and the depositCleared guard later trusts) — the
      // DB numeric(18,4) would otherwise round a >4-decimal input up past what
      // we OK'd.
      amount: formatMoney4(amount4),
      method,
      reference,
      note,
      idempotencyKey,
    },
  };
}
