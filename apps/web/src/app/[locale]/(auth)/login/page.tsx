'use client';

import { ArrowLeft, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OtpInput } from '@/components/ui/otp-input';
import { useCountdown } from '@/hooks/use-countdown';
import { useRouter } from '@/i18n/routing';
import {
  sendEmailOtp,
  sendPhoneOtp,
  verifyEmailOtp,
  verifyPhoneOtp,
} from '@/lib/auth/actions';

type Channel = 'email' | 'phone';
type Status = 'idle' | 'sending' | 'code-sent' | 'verifying' | 'error' | 'success';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function LoginPage() {
  const t = useTranslations('login');
  const router = useRouter();
  const [, startTransition] = useTransition();
  const countdown = useCountdown(RESEND_SECONDS);

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
        setError(res.error ?? t('error'));
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
        router.push('/onboarding');
      } else {
        // Stay on the verify step; show a localized error.
        setStatus('error');
        setError(res.error ?? t('error'));
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
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          {phase === 'request' && (
            <p className="text-sm text-muted-foreground">{t('signUpHint')}</p>
          )}
        </div>

        {phase === 'request' ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={channel === 'email' ? 'default' : 'outline'}
                size="sm"
                onClick={() => switchChannel('email')}
              >
                {t('emailLabel')}
              </Button>
              <Button
                type="button"
                variant={channel === 'phone' ? 'default' : 'outline'}
                size="sm"
                onClick={() => switchChannel('phone')}
              >
                {t('phoneLabel')}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="identifier">
                {channel === 'email' ? t('emailLabel') : t('phoneLabel')}
              </Label>
              <Input
                id="identifier"
                type={channel === 'email' ? 'email' : 'tel'}
                dir="ltr"
                inputMode={channel === 'email' ? 'email' : 'tel'}
                placeholder={
                  channel === 'email' ? t('emailPlaceholder') : '+20…'
                }
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send();
                }}
              />
              {channel === 'phone' && (
                <p className="text-sm text-muted-foreground">{t('phoneHint')}</p>
              )}
            </div>

            <Button
              className="w-full"
              onClick={send}
              disabled={busy || identifier.trim().length === 0}
            >
              {sending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {sending ? t('sending') : t('sendCode')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="font-medium">{t('codeSentTitle')}</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span dir="ltr" className="truncate">
                  {identifier}
                </span>
                <button
                  type="button"
                  onClick={changeIdentifier}
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <ArrowLeft className="size-3" aria-hidden />
                  {t('changeEmail')}
                </button>
              </div>
            </div>

            <OtpInput
              length={OTP_LENGTH}
              value={code}
              onChange={setCode}
              onComplete={(v) => verify(v)}
              disabled={busy}
              ariaLabel={t('codeLabel')}
              autoFocus
            />

            <Button
              className="w-full"
              onClick={() => verify()}
              disabled={busy || code.length < OTP_LENGTH}
            >
              {verifying && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {verifying ? t('verifying') : t('verify')}
            </Button>

            <div className="text-center text-sm text-muted-foreground">
              {countdown.remaining > 0 ? (
                <span>{t('resendIn', { time: countdown.formatted })}</span>
              ) : (
                <button
                  type="button"
                  onClick={send}
                  disabled={busy}
                  className="font-medium text-primary hover:underline disabled:opacity-50"
                >
                  {t('resend')}
                </button>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AuthShell>
  );
}
