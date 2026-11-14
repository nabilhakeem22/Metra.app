import 'server-only';
import { createHash } from 'node:crypto';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { cfEnv, isCloudflareRuntime } from '@/lib/cf/context';
import { isWrongCodeFailure, otpVerifyFailure, type AuthFailure } from './otp-failure';
import { readSignInPauseSeconds, recordWrongSignInCode } from './sign-in-failures-db';

// The sign-in pause (security batch 3, P2): the tenth wrong code typed for one
// address or phone inside an hour pauses checking codes for it until that hour
// ends. The Cloudflare throttle (otp-throttle.ts) counts per data centre; this
// count is global, one row per identifier in Postgres. The threshold and the
// hour live ONLY in packages/db/src/rls/functions/90-sign-in.sql.
//
// ROUND TRIPS it adds to a code check: one read before Supabase is asked, and
// one write only after Supabase refused the code. Nothing on a success: a right
// code clears no count, the hour ages out.
//
// FAILURE MODES (plan A4, the rule of lib/cf/rate-limit-binding.ts):
//  - A database ERROR in either call fails OPEN: one redacted log line, and the
//    check goes on. A database blip must not stop every sign-in.
//  - A MISSING Hyperdrive binding on Cloudflare fails CLOSED: Supabase sign-in
//    works without Postgres, so answering "not paused" there would switch the
//    pause off for ever and nothing would say so.
//
// The identifier and its hash are never logged.

/** sha256 hex of 'sign-in:' + identifier. `identifier` is already canonical (otp-route.ts), the string Supabase receives. */
export function signInIdentifierHash(identifier: string): string {
  return createHash('sha256').update(`sign-in:${identifier}`).digest('hex');
}

/** On Cloudflare the counter is reached through Hyperdrive only (lib/db/client.ts); off-platform it is the process database. */
function pauseStoreMissing(): boolean {
  return isCloudflareRuntime() && !cfEnv().HYPERDRIVE?.connectionString;
}

/**
 * The refusal a paused identifier reads: the wait in whole minutes, rounded up.
 * `minutes` picks the plural form and `minutesText` is what is shown, in Latin
 * digits in both languages (lib/format/plural-params.ts says why they are two).
 */
function pausedAnswer(seconds: number): ActionResult {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return err('otp_sign_in_paused', { minutes, minutesText: String(minutes) });
}

/** The safe-to-log view of a counter failure, with the identifier and its hash cut out of every field. */
function redactedFailure(error: unknown, identifier: string, identifierHash: string): Record<string, string> {
  const fields = loggableFailure(error);
  const withheld = [identifierHash, identifier].filter((value) => value.length > 0);
  for (const [field, text] of Object.entries(fields)) {
    fields[field] = withheld.reduce((kept, value) => kept.split(value).join('[withheld]'), text);
  }
  return fields;
}

/**
 * null = go ahead and ask Supabase. A paused identifier is refused with
 * `otp_sign_in_paused`; a missing counter store on Cloudflare with a logged
 * `generic`. A failed read is logged and answers null (fail open).
 */
export async function signInPauseRefusal(identifier: string): Promise<ActionResult | null> {
  if (pauseStoreMissing()) {
    return unexpectedFailure(
      'sign-in pause store missing',
      new Error('HYPERDRIVE binding is missing on the Cloudflare runtime. Refusing to check sign-in codes without the wrong-code pause.'),
    );
  }
  const identifierHash = signInIdentifierHash(identifier);
  try {
    const seconds = await readSignInPauseSeconds(identifierHash);
    return seconds === null ? null : pausedAnswer(seconds);
  } catch (error) {
    console.error('sign-in pause check failed', { error: redactedFailure(error, identifier, identifierHash) });
    return null;
  }
}

/** Counts one wrong code: the seconds of the pause the identifier is now in, or null. A failed count is logged and reads as null (fail open). */
async function pauseAfterWrongCode(identifier: string): Promise<number | null> {
  const identifierHash = signInIdentifierHash(identifier);
  try {
    return await recordWrongSignInCode(identifierHash);
  } catch (error) {
    console.error('sign-in failure record failed', { error: redactedFailure(error, identifier, identifierHash) });
    return null;
  }
}

/**
 * The answer to a code check Supabase refused. A wrong or expired code is
 * counted once; when that count starts or continues a pause, the answer is
 * `otp_sign_in_paused` instead of "that code is wrong". Every other failure
 * (a rate limit, an unknown code) is counted by nobody and answered as before.
 */
export async function failedVerifyAnswer(identifier: string, label: string, failure: AuthFailure): Promise<ActionResult> {
  const pausedSeconds = isWrongCodeFailure(failure) ? await pauseAfterWrongCode(identifier) : null;
  if (pausedSeconds === null) return otpVerifyFailure(label, failure);
  console.warn('sign-in paused after wrong codes');
  return pausedAnswer(pausedSeconds);
}
