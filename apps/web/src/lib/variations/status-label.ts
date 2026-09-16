// The status key the VARIATION REGISTER renders. PURE and CLIENT-SAFE: no
// imports beyond the erased status type, so the `'use client'` register can call
// it and carry no derivation of its own.
import type { VariationStatus } from '@metra/db';

/**
 * The message key under `variations.status` for one register row.
 *
 * `rejected` SPLITS BY WHO REJECTED IT, because the two are different commercial
 * facts and the studio has to act differently on them: a CLIENT refusal is a
 * negotiation signal — someone should call them — while a TERMINATION CASCADE is
 * bookkeeping that happened automatically when the contract was closed. The
 * register painted both with the same red "مرفوض" pill.
 *
 * Only `'staff'` splits, and only on `rejected`. The cascade is the ONLY staff
 * route to that status — there is no staff "reject VO" action — so the channel
 * is a complete discriminator rather than a heuristic. A null channel is a row
 * written before 0051 and keeps today's label, which is the same
 * no-regression rule the client-facing ladder follows.
 */
export function variationStatusKey(row: {
  status: VariationStatus;
  rejectionChannel: string | null;
}): string {
  if (row.status === 'rejected' && row.rejectionChannel === 'staff') {
    return 'rejected_on_termination';
  }
  return row.status;
}
