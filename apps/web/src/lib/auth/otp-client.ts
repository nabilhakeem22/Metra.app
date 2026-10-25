// The browser half of sign-in: the login form's calls to the sign-in code
// routes. A plain fetch, NOT a server action: the login page is a static asset
// and a POST to an asset path is a 405 (lib/auth/otp-contract.ts). Client-safe.
//
// The same names and answers the server actions had, so the form's error
// handling is unchanged:
// - a network failure rejects with the fetch TypeError (describeRejection says
//   "unreachable");
// - an answer that is not the JSON contract (a platform error page, a 1102)
//   rejects with a plain Error (describeRejection says "generic");
// - any JSON answer carrying a boolean `ok` is returned as is, at any status.
import type { ActionResult } from '@/lib/actions/result';
import {
  OTP_SEND_PATH,
  OTP_VERIFY_PATH,
  type LoginReturn,
  type OtpSendRequest,
  type OtpVerifyRequest,
  type OtpVerifyResult,
} from './otp-contract';

function isAnswer(body: unknown): body is ActionResult {
  return typeof body === 'object' && body !== null && typeof (body as { ok?: unknown }).ok === 'boolean';
}

async function postOtp<Result extends ActionResult>(path: string, request: OtpSendRequest | OtpVerifyRequest): Promise<Result> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const isJson = (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
  const body: unknown = isJson ? await response.json().catch(() => null) : null;
  // developer-only: the message carries the HTTP status code, never a person's data.
  if (!isAnswer(body)) throw new Error(`auth endpoint answered ${response.status}`);
  return body as Result;
}

export function sendEmailOtp(email: string): Promise<ActionResult> {
  return postOtp(OTP_SEND_PATH, { channel: 'email', identifier: email });
}

export function sendPhoneOtp(phone: string): Promise<ActionResult> {
  return postOtp(OTP_SEND_PATH, { channel: 'phone', identifier: phone });
}

/** `returnTo` is set when the sign-in began in the site app; undefined leaves `return` out of the body. */
export function verifyEmailOtp(email: string, token: string, returnTo?: LoginReturn): Promise<OtpVerifyResult> {
  return postOtp(OTP_VERIFY_PATH, { channel: 'email', identifier: email, token, return: returnTo });
}

export function verifyPhoneOtp(phone: string, token: string, returnTo?: LoginReturn): Promise<OtpVerifyResult> {
  return postOtp(OTP_VERIFY_PATH, { channel: 'phone', identifier: phone, token, return: returnTo });
}
