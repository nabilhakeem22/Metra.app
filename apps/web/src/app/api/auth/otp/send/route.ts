import { parseOtpSendRequest } from '@/lib/auth/otp-contract';
import { sendOtpCore } from '@/lib/auth/otp';
import { otpEndpoint } from '@/lib/auth/otp-route';

// POST { channel, identifier }: send a sign-in code by email or SMS. Answers
// exactly what the sendEmailOtp / sendPhoneOtp server actions returned; the
// static login page cannot post server actions (lib/auth/otp-contract.ts).
export const dynamic = 'force-dynamic';

export const POST = otpEndpoint('otp send route failed', 'send', parseOtpSendRequest, sendOtpCore);
