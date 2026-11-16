import { parseOtpSendRequest, type CaptchaRule } from '@/lib/auth/otp-contract';
import { sendOtpCore } from '@/lib/auth/otp';
import { otpEndpoint } from '@/lib/auth/otp-route';
import { turnstileSiteKey } from '../../../../../../scripts/turnstile-site-key.mjs';

// POST { channel, identifier }: send a sign-in code by email or SMS. Answers
// exactly what the sendEmailOtp / sendPhoneOtp server actions returned; the
// static login page cannot post server actions (lib/auth/otp-contract.ts).
//
// THE CHALLENGE IS REQUIRED WHERE IT IS SHOWN. A build with the Turnstile site
// key shows the widget on the login page, and that page sends a token with
// every send (use-captcha.ts hands one over or sends nothing). So in that build
// a send with no token did not come from the page: 400 malformed, before the
// throttle is charged and before Supabase is asked. A build with no site key
// takes a send without a token, as before.
export const dynamic = 'force-dynamic';

/** Read literally, so Next inlines the same build value the login form's captcha hook reads. */
const CAPTCHA_RULE: CaptchaRule = turnstileSiteKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) ? 'required' : 'optional';

export const POST = otpEndpoint(
  'otp send route failed',
  'send',
  (body) => parseOtpSendRequest(body, CAPTCHA_RULE),
  sendOtpCore,
);
