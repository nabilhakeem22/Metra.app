import 'server-only';
import { NextResponse } from 'next/server';
import type { ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { readSameOriginJson } from '@/lib/http/same-origin-json';

// The one shape of both sign-in code endpoints (app/api/auth/otp/{send,verify}):
// a same-origin JSON POST, parsed to its request, answered by its core.
//   403 forbidden  missing or foreign Origin, or a body not declared JSON
//   400 malformed  a body that is not JSON, or not the request's shape
//   200            the core's ActionResult, a refusal included
//   500 generic    the core threw (one log line, its reference in the body)
// Never cached: the answers carry session cookies and per-person refusals.

const answer = (body: ActionResult, status: number) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export function otpEndpoint<Input>(
  label: string,
  parse: (body: unknown) => Input | null,
  core: (input: Input) => Promise<ActionResult>,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const read = await readSameOriginJson(request);
    if (read.kind === 'forbidden') return answer({ ok: false, error: 'forbidden' }, 403);
    const input = read.kind === 'ok' ? parse(read.body) : null;
    if (input === null) return answer({ ok: false, error: 'malformed' }, 400);
    try {
      return answer(await core(input), 200);
    } catch (thrown) {
      return answer(unexpectedFailure(label, thrown), 500);
    }
  };
}
