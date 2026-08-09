'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  sendEmailOtp,
  sendPhoneOtp,
  verifyEmailOtp,
  verifyPhoneOtp,
} from '@/lib/auth/actions';
import { useRouter } from '@/i18n/routing';

type Channel = 'email' | 'phone';
type Step = 'request' | 'verify';

export default function LoginPage() {
  const t = useTranslations('login');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [channel, setChannel] = useState<Channel>('email');
  const [step, setStep] = useState<Step>('request');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function requestCode() {
    setError(null);
    startTransition(async () => {
      const res =
        channel === 'email'
          ? await sendEmailOtp(identifier)
          : await sendPhoneOtp(identifier);
      if (res.ok) {
        setStep('verify');
        setInfo(t('checkEmail'));
      } else {
        setError(res.error ?? t('error'));
      }
    });
  }

  function verifyCode() {
    setError(null);
    startTransition(async () => {
      const res =
        channel === 'email'
          ? await verifyEmailOtp(identifier, code)
          : await verifyPhoneOtp(identifier, code);
      if (res.ok) {
        router.push('/onboarding');
      } else {
        setError(res.error ?? t('error'));
      }
    });
  }

  return (
    <main className="container flex min-h-screen items-center justify-center py-16">
      <div className="w-full max-w-sm space-y-6 rounded-lg border p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{t('title')}</h1>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={channel === 'email' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setChannel('email');
              setStep('request');
            }}
          >
            {t('emailLabel')}
          </Button>
          <Button
            type="button"
            variant={channel === 'phone' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setChannel('phone');
              setStep('request');
            }}
          >
            {t('phoneLabel')}
          </Button>
        </div>

        {step === 'request' ? (
          <div className="space-y-3">
            <Label htmlFor="identifier">
              {channel === 'email' ? t('emailLabel') : t('phoneLabel')}
            </Label>
            <Input
              id="identifier"
              type={channel === 'email' ? 'email' : 'tel'}
              placeholder={channel === 'email' ? t('emailPlaceholder') : '+20…'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
            {channel === 'phone' && (
              <p className="text-sm text-muted-foreground">{t('phoneHint')}</p>
            )}
            <Button
              className="w-full"
              onClick={requestCode}
              disabled={pending || identifier.length === 0}
            >
              {t('sendCode')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            <Label htmlFor="code">{t('codeLabel')}</Label>
            <Input
              id="code"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              className="w-full"
              onClick={verifyCode}
              disabled={pending || code.length === 0}
            >
              {t('verify')}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}
