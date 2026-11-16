import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSignInPauseSeconds, recordWrongSignInCode } from '@/lib/auth/sign-in-failures-db';
import { failedVerifyAnswer, signInIdentifierHash, signInPauseRefusal } from '@/lib/auth/sign-in-lockout';
import { closeExecutionFixture, ownerQuery } from './execution-fixture';
import { failuresOf } from './sign-in-failures-fixture';

// Security batch 3, P2, the app half against a real Postgres: the leaf reaches
// both definer functions on the connection role and reads their integer answer,
// ten refused codes pause an identifier, and the pause the app sets is the row
// the owner's lift statement (docs/DEPLOY.md) deletes. The counting rule itself
// is sign-in-failures.dbtest.ts; Supabase is not involved here.

const WRONG_CODE = { code: 'otp_expired', status: 403 };
const CODE_REFUSED = { ok: false, error: 'check_fields', fields: { token: { code: 'otp_verify_failed' } } };
const PAUSED_FOR_THE_HOUR = { ok: false, error: 'otp_sign_in_paused', params: { minutes: 60, minutesText: '60' } };

const identifiers: string[] = [];

/** A sign-in address nobody else uses, whose row the teardown removes. */
function freshIdentifier(): string {
  const identifier = `pause-${randomUUID()}@lockout.example`;
  identifiers.push(identifier);
  return identifier;
}

async function pauseNow(identifierHash: string): Promise<void> {
  await ownerQuery(`update public.sign_in_failures set failures = 10 where identifier_hash = $1`, [identifierHash]);
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // A refused code writes its usual log line; ten of them say nothing new here.
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  // A counter call that failed is logged and survived (fail open): here it is a defect.
  const failedOpen = errors.mock.calls.map(([label]) => String(label)).filter((label) => label.startsWith('sign-in'));
  vi.restoreAllMocks();
  await ownerQuery(`delete from public.sign_in_failures where identifier_hash = any($1::text[])`, [identifiers.map(signInIdentifierHash)]);
  identifiers.length = 0;
  expect(failedOpen).toEqual([]);
});

afterAll(async () => {
  await closeExecutionFixture();
});

describe('the sign-in pause, from the verify core down to the table', () => {
  it('nine refused codes leave the identifier open; the tenth pauses it and the next check is refused', async () => {
    const identifier = freshIdentifier();
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      expect(await failedVerifyAnswer(identifier, 'dbtest refused code', WRONG_CODE), `refused code ${String(attempt)}`).toEqual(CODE_REFUSED);
    }
    expect(await signInPauseRefusal(identifier)).toBeNull();

    expect(await failedVerifyAnswer(identifier, 'dbtest refused code', WRONG_CODE)).toEqual(PAUSED_FOR_THE_HOUR);
    expect(await signInPauseRefusal(identifier)).toEqual(PAUSED_FOR_THE_HOUR);
    expect(await failuresOf(signInIdentifierHash(identifier))).toBe(10);
    expect(await signInPauseRefusal(freshIdentifier()), 'another identifier is not paused').toBeNull();
  });

  it('a failure that is not a refused code is never counted', async () => {
    const identifier = freshIdentifier();
    await failedVerifyAnswer(identifier, 'dbtest rate limit', { code: 'over_request_rate_limit', status: 429 });
    expect(await failuresOf(signInIdentifierHash(identifier))).toBeUndefined();
  });

  it('the leaf answers null while open and a whole number of seconds while paused', async () => {
    const identifierHash = signInIdentifierHash(freshIdentifier());
    expect(await readSignInPauseSeconds(identifierHash)).toBeNull();
    expect(await recordWrongSignInCode(identifierHash)).toBeNull();
    await pauseNow(identifierHash);
    for (const seconds of [await readSignInPauseSeconds(identifierHash), await recordWrongSignInCode(identifierHash)]) {
      expect(Number.isInteger(seconds)).toBe(true);
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(3600);
    }
  });

  it("the owner's lift statement deletes exactly the row the app paused", async () => {
    const identifier = freshIdentifier();
    await recordWrongSignInCode(signInIdentifierHash(identifier));
    await pauseNow(signInIdentifierHash(identifier));
    expect((await signInPauseRefusal(identifier))?.error).toBe('otp_sign_in_paused');

    const lifted = await ownerQuery(
      `delete from public.sign_in_failures
        where identifier_hash = encode(sha256(convert_to('sign-in:' || $1, 'UTF8')), 'hex')
        returning identifier_hash`,
      [identifier],
    );
    expect(lifted).toEqual([{ identifier_hash: signInIdentifierHash(identifier) }]);
    expect(await signInPauseRefusal(identifier)).toBeNull();
  });
});
