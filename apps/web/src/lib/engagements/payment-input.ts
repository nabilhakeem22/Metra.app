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
import { fieldsFailed } from '@/lib/actions/field-errors';
import { err, type ActionResult } from '@/lib/actions/result';
import { NOT_UUID, optionalUuid } from '@/lib/uuid';
import { readPaymentFields } from './payment-field-rules';

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

/** The canonical payment, or the answer that refuses it: every typed-value
 *  refusal under its field (payment-field-rules.ts), else the shape no form can
 *  send (an unknown kind, a malformed key). */
export function normalizePayment(
  input: RawPaymentFields,
): { ok: true; value: CleanPayment } | { ok: false; refusal: ActionResult } {
  if (typeof input.kind !== 'string' || !KIND_SET.has(input.kind)) {
    return { ok: false, refusal: err('invalid') };
  }
  const typed = readPaymentFields(input);
  if (!typed.ok) return { ok: false, refusal: fieldsFailed(typed.errors) };

  // Normalise the idempotency key: trim; empty/whitespace/undefined -> null (a
  // plain append). A present-but-malformed key is a coded 'invalid', and so is a
  // present-but-non-string one — see optionalUuid for why that is reachable.
  const idempotencyKey = optionalUuid(input.idempotencyKey);
  if (idempotencyKey === NOT_UUID) return { ok: false, refusal: err('invalid') };

  // The amount is persisted canonical so the STORED amount is exactly the one
  // the app validated (and the depositCleared guard later trusts): the DB
  // numeric(18,4) would otherwise round a >4-decimal input up past what we OK'd.
  return { ok: true, value: { kind: input.kind, ...typed.values, idempotencyKey } };
}
