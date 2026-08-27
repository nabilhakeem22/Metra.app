'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { resolveActionError } from '@/lib/actions/error-message';
import { AuthShell } from '@/components/auth/auth-shell';
import { useCountdown } from '@/hooks/use-countdown';
import { Link, useRouter } from '@/i18n/routing';
import {
  resolvePostLoginPath,
  sendEmailOtp,
  sendPhoneOtp,
  verifyEmailOtp,
  verifyPhoneOtp,
} from '@/lib/auth/actions';
import { LoginRequestStep } from './login-request-step';
import { LoginVerifyStep } from './login-verify-step';

export type Channel = 'email' | 'phone';
type Status = 'idle' | 'sending' | 'code-sent' | 'verifying' | 'error' | 'success';
type Mode = 'signin' | 'signup';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

/**
 * Passwordless auth form. A `?mode=signup` / `?mode=signin` (default) search
 * param drives the sign-in vs create-account FRAMING only — heading, subcopy,
 * and the switch link. The OTP send/verify flow and the post-login routing are
 * identical in both modes: a new email still auto-creates the account and lands
 * on onboarding, an existing one on the dashboard.
 */
export function LoginForm() {
  const t = useTranslations('login');
  const th = useTranslations('hints.auth');
  const te = useTranslations('errors');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const countdown = useCountdown(RESEND_SECONDS);

  const mode: Mode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';

  const [channel, setChannel] = useState<Channel>('email');
  const [phase, setPhase] = useState<'request' | 'verify'>('request');
  const [status, setStatus] = useState<Status>('idle');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sending = status === 'sending';
  const verifying = status === 'verifying';
  const busy = sending || verifying || status === 'success';

  function send() {
    setError(null);
    setStatus('sending');
    startTransition(async () => {
      const res =
        channel === 'email'
          ? await sendEmailOtp(identifier)
          : await sendPhoneOtp(identifier);
      if (res.ok) {
        setPhase('verify');
        setStatus('code-sent');
        setCode('');
        countdown.start(RESEND_SECONDS);
      } else {
        setStatus('error');
        setError(resolveActionError(res.error, te));
      }
    });
  }

  function verify(fullCode?: string) {
    const value = fullCode ?? code;
    if (value.length < OTP_LENGTH) return;
    setError(null);
    setStatus('verifying');
    startTransition(async () => {
      const res =
        channel === 'email'
          ? await verifyEmailOtp(identifier, value)
          : await verifyPhoneOtp(identifier, value);
      if (res.ok) {
        setStatus('success');
        // Route by membership: dashboard if they already have an org, else onboarding.
        const path = await resolvePostLoginPath();
        router.push(path);
      } else {
        // Stay on the verify step; show a localized error.
        setStatus('error');
        setError(resolveActionError(res.error, te));
      }
    });
  }

  function changeIdentifier() {
    setPhase('request');
    setStatus('idle');
    setCode('');
    setError(null);
    countdown.reset();
  }

  function switchChannel(next: Channel) {
    setChannel(next);
    changeIdentifier();
  }

  return (
    <AuthShell showValueProp>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === 'signup' ? t('signUpTitle') : t('signInTitle')}
          </h1>
          {phase === 'request' && (
            <p className="text-sm text-muted-foreground">
              {mode === 'signup' ? t('signUpSubtitle') : t('signInSubtitle')}
            </p>
          )}
        </div>

        {phase === 'request' ? (
          <LoginRequestStep
            t={t}
            th={th}
            channel={channel}
            switchChannel={switchChannel}
            identifier={identifier}
            setIdentifier={setIdentifier}
            send={send}
            busy={busy}
            sending={sending}
          />
        ) : (
          <LoginVerifyStep
            t={t}
            th={th}
            identifier={identifier}
            changeIdentifier={changeIdentifier}
            code={code}
            setCode={setCode}
            verify={verify}
            send={send}
            busy={busy}
            verifying={verifying}
            otpLength={OTP_LENGTH}
            countdown={countdown}
          />
        )}

        <p
          role="status"
          aria-live="polite"
          className="min-h-[1.25rem] text-sm text-destructive"
        >
          {error}
        </p>

        <p className="text-center text-sm text-muted-foreground">
          {mode === 'signup' ? (
            <>
              {t('switchToSignInPrompt')}{' '}
              <Link
                href={{ pathname: '/login', query: { mode: 'signin' } }}
                className="font-medium text-primary hover:underline"
              >
                {t('switchToSignInLink')}
              </Link>
            </>
          ) : (
            <>
              {t('switchToSignUpPrompt')}{' '}
              <Link
                href={{ pathname: '/login', query: { mode: 'signup' } }}
                className="font-medium text-primary hover:underline"
              >
                {t('switchToSignUpLink')}
              </Link>
            </>
          )}
        </p>
      </div>
    </AuthShell>
  );
}
