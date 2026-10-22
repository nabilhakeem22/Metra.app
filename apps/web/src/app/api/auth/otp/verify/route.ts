import { parseOtpVerifyRequest } from '@/lib/auth/otp-contract';
import { verifyOtpCore } from '@/lib/auth/otp';
import { otpEndpoint } from '@/lib/auth/otp-route';

// POST { channel, identifier, token }: check a sign-in code. A refusal answers
// what the verifyEmailOtp / verifyPhoneOtp server actions returned; a success
// sets the Supabase session cookies and answers { ok: true, next } with the
// post-login path (dashboard or onboarding), so the form needs no second call.
export const dynamic = 'force-dynamic';

export const POST = otpEndpoint('otp verify route failed', parseOtpVerifyRequest, verifyOtpCore);
