'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useCountdown } from '@/hooks/use-countdown';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import type { ActionResult } from '@/lib/actions/result';
import { sendEmailOtp, sendPhoneOtp, verifyEmailOtp, verifyPhoneOtp } from '@/lib/auth/otp-client';
import {
  otpCodeErrors,
  otpIdentifierErrors,
  type OtpChannel,
  type OtpField,
} from '@/lib/auth/otp-field-rules';

type Status = 'idle' | 'sending' | 'code-sent' | 'verifying' | 'error' | 'success';

const RESEND_SECONDS = 60;

/**
 * The passwordless sign-in flow: ask for a code, then type it. Each step's
 * refusal lands under its own box (the identifier, then the code); one that
 * belongs to no box (a rate limit, a provider that is off, a dropped
 * connection) goes to the status line. A rejected call leaves the busy state,
 * so the button never spins for ever.
 */
export function useOtpFlow() {
  const te = useTranslations('errors');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const countdown = useCountdown(RESEND_SECONDS);
  const [channel, setChannel] = useState<OtpChannel>('email');
  const [phase, setPhase] = useState<'request' | 'verify'>('request');
  const [status, setStatus] = useState<Status>('idle');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  // Only the box on screen can show a refusal; one about the other step's box
  // (a resend that finds the address refused) is said in the status line.
  const rendered: readonly OtpField[] = phase === 'request' ? [channel] : ['token'];
  const errors = useFieldErrors({ fields: rendered, translate: te });

  /** Run one call; its answer when it succeeded, else null. A refusal or a rejection is shown. */
  async function attempt<Result extends ActionResult>(call: () => Promise<Result>): Promise<Result | null> {
    try {
      const result = await call();
      if (!errors.applyResult(result)) return result;
    } catch (rejection) {
      errors.applyRejection(rejection);
    }
    setStatus('error');
    return null;
  }

  function send(): void {
    if (errors.applyLocal(otpIdentifierErrors(channel, identifier))) return;
    setStatus('sending');
    startTransition(async () => {
      const sent = await attempt(() =>
        channel === 'email' ? sendEmailOtp(identifier) : sendPhoneOtp(identifier),
      );
      if (!sent) return;
      setPhase('verify');
      setStatus('code-sent');
      setCode('');
      countdown.start(RESEND_SECONDS);
    });
  }

  function verify(fullCode?: string): void {
    const value = fullCode ?? code;
    if (errors.applyLocal(otpCodeErrors(value))) return;
    setStatus('verifying');
    startTransition(async () => {
      const verified = await attempt(() =>
        channel === 'email' ? verifyEmailOtp(identifier, value) : verifyPhoneOtp(identifier, value),
      );
      if (!verified) return;
      setStatus('success');
      // The verify answer names the destination by membership: the dashboard
      // when they already have an org, else onboarding.
      router.push(verified.next ?? '/dashboard');
    });
  }

  function changeIdentifier(): void {
    setPhase('request');
    setStatus('idle');
    setCode('');
    errors.clear();
    countdown.reset();
  }

  return {
    channel,
    switchChannel(next: OtpChannel) {
      setChannel(next);
      changeIdentifier();
    },
    phase,
    status,
    identifier,
    setIdentifier(value: string) {
      errors.bind(channel).onEdit();
      setIdentifier(value);
    },
    code,
    setCode(value: string) {
      errors.bind('token').onEdit();
      setCode(value);
    },
    countdown,
    errors,
    send,
    verify,
    changeIdentifier,
  };
}
