// The sign-in code endpoints' wire contract. PURE and CLIENT-SAFE: the login
// form (lib/auth/otp-client.ts) and the route handlers (app/api/auth/otp/*)
// share it.
//
// The login page is a static asset served before the Worker runs, and a POST
// to an asset path is a 405 by platform design, so the form cannot use server
// actions (they post to the page URL). It calls these same-origin JSON routes.
import type { ActionResult } from '@/lib/actions/result';
import { MAX_IDENTIFIER_LENGTH, type OtpChannel } from './otp-field-rules';

export const OTP_SEND_PATH = '/api/auth/otp/send';
export const OTP_VERIFY_PATH = '/api/auth/otp/verify';

/** Where a person goes right after a code is accepted. */
export type PostLoginPath = '/dashboard' | '/onboarding' | '/site';

/** Where a sign-in was started from: the site app's login link says `?return=site`. */
export type LoginReturn = 'site';

/** The `return` a login address or a verify request names, or undefined for any other value. */
export function loginReturnOf(value: unknown): LoginReturn | undefined {
  return value === 'site' ? 'site' : undefined;
}

/** Who a sign-in code is for: both requests carry it. */
export interface OtpIdentity {
  channel: OtpChannel;
  identifier: string;
}

export interface OtpSendRequest extends OtpIdentity {
  /** The login page's Turnstile token; absent when the build has no site key. Supabase checks it (CAPTCHA on). */
  captchaToken?: string;
}

export interface OtpVerifyRequest extends OtpIdentity {
  token: string;
  /** Present only when the sign-in began in the site app. */
  return?: LoginReturn;
}

/** A verify answer: `next` is present exactly when `ok` is true. */
export type OtpVerifyResult = ActionResult & { next?: PostLoginPath };

/** A code is 6 digits; anything this long is not a code. */
const MAX_TOKEN_LENGTH = 16;

/** Cloudflare: a Turnstile token is at most 2048 characters. */
export const MAX_CAPTCHA_TOKEN_LENGTH = 2048;

function isChannel(value: unknown): value is OtpChannel {
  return value === 'email' || value === 'phone';
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function fieldsOf(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** Who the code is for, or null when the body has the wrong shape. Any other field is left behind. */
function parseOtpIdentity(body: unknown): OtpIdentity | null {
  const fields = fieldsOf(body);
  if (!fields || !isChannel(fields.channel) || !isBoundedString(fields.identifier, MAX_IDENTIFIER_LENGTH)) return null;
  return { channel: fields.channel, identifier: fields.identifier };
}

/**
 * The send request, or null when the identity is malformed, or a captchaToken
 * is present but not a non-empty string of at most 2048 characters.
 */
export function parseOtpSendRequest(body: unknown): OtpSendRequest | null {
  const identity = parseOtpIdentity(body);
  const captchaToken = fieldsOf(body)?.captchaToken;
  if (!identity) return null;
  if (captchaToken === undefined) return identity;
  return isBoundedString(captchaToken, MAX_CAPTCHA_TOKEN_LENGTH) && captchaToken !== '' ? { ...identity, captchaToken } : null;
}

/**
 * The verify request, or null when the body has the wrong shape (a `return`
 * other than 'site' included). A captchaToken is never copied: verify is not challenged.
 */
export function parseOtpVerifyRequest(body: unknown): OtpVerifyRequest | null {
  const identity = parseOtpIdentity(body);
  const fields = fieldsOf(body);
  const token = fields?.token;
  if (!identity || !isBoundedString(token, MAX_TOKEN_LENGTH)) return null;
  if (fields?.return === undefined) return { ...identity, token };
  const returnTo = loginReturnOf(fields.return);
  return returnTo ? { ...identity, token, return: returnTo } : null;
}
