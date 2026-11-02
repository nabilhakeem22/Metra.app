'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useCountdown } from '@/hooks/use-countdown';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import { err, type ActionResult } from '@/lib/actions/result';
import { sendEmailOtp, sendPhoneOtp, verifyEmailOtp, verifyPhoneOtp } from '@/lib/auth/otp-client';
import { loginReturnOf } from '@/lib/auth/otp-contract';
import {
  otpCodeErrors,
  otpIdentifierErrors,
  type OtpChannel,
  type OtpField,
} from '@/lib/auth/otp-field-rules';
import { signInErrorTranslator } from './sign-in-errors';
import type { CaptchaPass } from './use-captcha';

type Status = 'idle' | 'sending' | 'code-sent' | 'verifying' | 'error' | 'success';

const RESEND_SECONDS = 60;

/**
 * The passwordless sign-in flow: ask for a code, then type it. Each step's
 * refusal lands under its own box (the identifier, then the code); one that
 * belongs to no box (a rate limit, a provider that is off, a dropped
 * connection) goes to the status line. A rejected call leaves the busy state,
 * so the button never spins for ever. Every send (Resend included) takes a
 * fresh challenge token from `takeCaptcha`; without one nothing is sent.
 */
export function useOtpFlow(takeCaptcha: () => CaptchaPass) {
  const te = useTranslations('errors');
  const tl = useTranslations('login');
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
  const errors = useFieldErrors({ fields: rendered, translate: signInErrorTranslator(te, tl('pageRefused')) });

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
    // After the box check, so an empty box never spends a token.
    const pass = takeCaptcha();
    if (!pass.ok) {
      errors.applyResult(err(pass.error));
      setStatus('error');
      return;
    }
    setStatus('sending');
    startTransition(async () => {
      const sent = await attempt(() =>
        channel === 'email' ? sendEmailOtp(identifier, pass.token) : sendPhoneOtp(identifier, pass.token),
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
    // The site app's login link says `?return=site`; the static page reads it here, in the browser.
    const returnTo = loginReturnOf(new URLSearchParams(window.location.search).get('return'));
    startTransition(async () => {
      const verified = await attempt(() =>
        channel === 'email' ? verifyEmailOtp(identifier, value, returnTo) : verifyPhoneOtp(identifier, value, returnTo),
      );
      if (!verified) return;
      setStatus('success');
      // The verify answer names the destination: the site app, the dashboard
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
