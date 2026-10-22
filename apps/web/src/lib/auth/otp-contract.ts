// The sign-in code endpoints' wire contract. PURE and CLIENT-SAFE: the login
// form (lib/auth/otp-client.ts) and the route handlers (app/api/auth/otp/*)
// share it.
//
// The login page is a static asset served before the Worker runs, and a POST
// to an asset path is a 405 by platform design, so the form cannot use server
// actions (they post to the page URL). It calls these same-origin JSON routes.
import type { ActionResult } from '@/lib/actions/result';
import type { OtpChannel } from './otp-field-rules';

export const OTP_SEND_PATH = '/api/auth/otp/send';
export const OTP_VERIFY_PATH = '/api/auth/otp/verify';

/** Where a person goes right after a code is accepted. */
export type PostLoginPath = '/dashboard' | '/onboarding';

export interface OtpSendRequest {
  channel: OtpChannel;
  identifier: string;
}

export interface OtpVerifyRequest {
  channel: OtpChannel;
  identifier: string;
  token: string;
}

/** A verify answer: `next` is present exactly when `ok` is true. */
export type OtpVerifyResult = ActionResult & { next?: PostLoginPath };

/** The longest address RFC 5321 allows; a phone number is far shorter. */
const MAX_IDENTIFIER_LENGTH = 320;
/** A code is 6 digits; anything this long is not a code. */
const MAX_TOKEN_LENGTH = 16;

function isChannel(value: unknown): value is OtpChannel {
  return value === 'email' || value === 'phone';
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function fieldsOf(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** The send request, or null when the body has the wrong shape. */
export function parseOtpSendRequest(body: unknown): OtpSendRequest | null {
  const fields = fieldsOf(body);
  if (!fields || !isChannel(fields.channel) || !isBoundedString(fields.identifier, MAX_IDENTIFIER_LENGTH)) return null;
  return { channel: fields.channel, identifier: fields.identifier };
}

/** The verify request, or null when the body has the wrong shape. */
export function parseOtpVerifyRequest(body: unknown): OtpVerifyRequest | null {
  const send = parseOtpSendRequest(body);
  const token = fieldsOf(body)?.token;
  if (!send || !isBoundedString(token, MAX_TOKEN_LENGTH)) return null;
  return { ...send, token };
}
