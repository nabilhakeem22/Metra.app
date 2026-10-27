import 'server-only';
import { NextResponse } from 'next/server';
import type { ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { readSameOriginJson } from '@/lib/http/same-origin-json';
import type { OtpSendRequest } from './otp-contract';
import { canonicalOtpIdentifier } from './otp-identifier';
import { otpThrottleRefusal, type OtpStep } from './otp-throttle';

// The one shape of both sign-in code endpoints (app/api/auth/otp/{send,verify}):
// a same-origin JSON POST, parsed to its request, its identifier made canonical
// ONCE (otp-identifier.ts: the throttle keys and Supabase receives that same
// string), throttled, answered by its core.
//   403 forbidden         missing or foreign Origin, or a body not declared JSON
//   400 malformed         a body that is not JSON, is over 4 KiB, or is not the request's shape
//   429 otp_rate_limited  past the per-IP or per-identifier budget (lib/auth/otp-throttle.ts),
//                         with retry-after; Supabase is never called
//   500 generic           a throttle binding is missing on Cloudflare, or the core threw
//                         (one log line, its reference in the body)
//   200                   the core's ActionResult, a refusal included
// Never cached: the answers carry session cookies and per-person refusals.

const RETRY_AFTER_SECONDS = '60';

const answer = (body: ActionResult, status: number, extraHeaders: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...extraHeaders } });

export function otpEndpoint<Input extends OtpSendRequest>(
  label: string,
  step: OtpStep,
  parse: (body: unknown) => Input | null,
  core: (input: Input) => Promise<ActionResult>,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const read = await readSameOriginJson(request);
    if (read.kind === 'forbidden') return answer({ ok: false, error: 'forbidden' }, 403);
    const parsed = read.kind === 'ok' ? parse(read.body) : null;
    if (parsed === null) return answer({ ok: false, error: 'malformed' }, 400);
    const input = { ...parsed, identifier: canonicalOtpIdentifier(parsed.channel, parsed.identifier) };
    const refused = await otpThrottleRefusal(request, step, input.identifier);
    if (refused) {
      return answer(refused.body, refused.status, refused.status === 429 ? { 'retry-after': RETRY_AFTER_SECONDS } : {});
    }
    try {
      return answer(await core(input), 200);
    } catch (thrown) {
      return answer(unexpectedFailure(label, thrown), 500);
    }
  };
}
