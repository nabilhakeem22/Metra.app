// The design-fee claim function the client home's code-checked act wraps,
// app_delivery_claim_payment_by_token, called directly. The APP never does
// (OD2 strict, H5: no "I paid" without a code; the grep in
// src/lib/client-home/no-unverified-claim.test.ts holds that); the DB tests of
// the function's own rules (the amount lock, the states, the notifications)
// call it through this, with the arguments and the answer mapping the app's
// direct call had until H5. Not a test file. One connection per call, closed
// before it returns, so a test file needs no extra teardown.
import { createSql } from '@metra/db';
import { mapSignalSdfCode, type SignalSdfResult } from '@/lib/share/sdf-result';
import { hashShareToken } from '@/lib/share/token';

export async function claimPaymentByToken(
  rawToken: string,
  input: { milestoneKind: string; note?: string | null; actorName?: string | null; ip?: string | null; userAgent?: string | null },
): Promise<SignalSdfResult> {
  const token = rawToken.trim();
  if (!token) return { ok: false, error: 'token_invalid' };
  const sql = createSql(process.env.DATABASE_URL as string, { max: 1 });
  try {
    const [row] = await sql.unsafe<Array<{ code: string }>>(
      `select public.app_delivery_claim_payment_by_token($1, $2, $3, $4, $5, $6) as code`,
      [hashShareToken(token), input.milestoneKind, input.note ?? null, input.actorName ?? null, input.ip ?? null, input.userAgent ?? null],
    );
    return mapSignalSdfCode(row?.code);
  } finally {
    await sql.end();
  }
}
