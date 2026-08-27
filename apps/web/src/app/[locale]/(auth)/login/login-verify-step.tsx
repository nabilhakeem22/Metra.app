'use client';

import { ArrowLeft, Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldHint } from '@/components/ui/field-hint';
import { OtpInput } from '@/components/ui/otp-input';
import type { useCountdown } from '@/hooks/use-countdown';

// The OTP verify step: code entry + verify button + resend countdown. All state
// and the verify/send/change-identifier handlers live in the parent
// (LoginForm); this child is presentational, driven by the passed value +
// callbacks.
export function LoginVerifyStep({
  t,
  th,
  identifier,
  changeIdentifier,
  code,
  setCode,
  verify,
  send,
  busy,
  verifying,
  otpLength,
  countdown,
}: {
  t: ReturnType<typeof useTranslations<'login'>>;
  th: ReturnType<typeof useTranslations<'hints.auth'>>;
  identifier: string;
  changeIdentifier: () => void;
  code: string;
  setCode: (value: string) => void;
  verify: (fullCode?: string) => void;
  send: () => void;
  busy: boolean;
  verifying: boolean;
  otpLength: number;
  countdown: ReturnType<typeof useCountdown>;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="inline-flex items-center font-medium">
          {t('codeSentTitle')}
          <FieldHint hint={th('otp')} />
        </p>
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
        length={otpLength}
        value={code}
        onChange={setCode}
        onComplete={(v) => verify(v)}
        disabled={busy}
        ariaLabel={t('codeLabel')}
        autoFocus
      />

      <Button
        className="h-11 w-full"
        onClick={() => verify()}
        disabled={busy || code.length < otpLength}
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
  );
}
