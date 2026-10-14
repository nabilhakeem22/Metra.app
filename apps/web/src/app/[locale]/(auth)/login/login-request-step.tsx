'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import type { OtpChannel } from '@/lib/auth/otp-field-rules';

// The OTP request step: channel toggle + identifier field + send button. All
// state and the send handler live in the flow (useOtpFlow); this child is
// presentational, driven by the passed value + callbacks. Send is never
// disabled for an empty box: pressing it says, under the box, what is missing.
export function LoginRequestStep({
  t,
  th,
  channel,
  switchChannel,
  identifier,
  setIdentifier,
  identifierError,
  send,
  busy,
  sending,
}: {
  t: ReturnType<typeof useTranslations<'login'>>;
  th: ReturnType<typeof useTranslations<'hints.auth'>>;
  channel: OtpChannel;
  switchChannel: (next: OtpChannel) => void;
  identifier: string;
  setIdentifier: (value: string) => void;
  identifierError: string | undefined;
  send: () => void;
  busy: boolean;
  sending: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* A CHOICE, announced as one. Two buttons whose only difference was a
          `variant` told a screen reader nothing about which was selected -- or
          that they were alternatives at all. `radiogroup` plus `aria-checked`
          says both. */}
      <div
        role="radiogroup"
        aria-label={t('channelLabel')}
        className="inline-flex gap-1 rounded-pill bg-[color:var(--track)] p-1"
      >
        {(['email', 'phone'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={channel === option}
            onClick={() => switchChannel(option)}
            className={`rounded-pill px-3.5 py-1.5 text-small transition-colors ${
              channel === option
                ? 'bg-card font-bold text-[color:var(--text)] shadow-sm'
                : 'font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text)]'
            }`}
          >
            {option === 'email' ? t('emailLabel') : t('phoneLabel')}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {/* The hint FOLLOWS the channel. It was hardcoded to the email one, so
            choosing "Phone number" still promised an email -- to the site
            engineers the phone path exists for. */}
        <FormField
          id="identifier"
          label={channel === 'email' ? t('emailLabel') : t('phoneLabel')}
          hint={channel === 'email' ? th('email') : th('phone')}
          error={identifierError}
        >
          <Input
            type={channel === 'email' ? 'email' : 'tel'}
            dir="ltr"
            inputMode={channel === 'email' ? 'email' : 'tel'}
            placeholder={channel === 'email' ? t('emailPlaceholder') : '+20…'}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
          />
        </FormField>
        {channel === 'phone' && (
          <p className="text-body text-muted-foreground">{t('phoneHint')}</p>
        )}
      </div>

      <Button
        variant="default"
        className="h-11 w-full"
        onClick={send}
        disabled={busy}
      >
        {sending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {sending ? t('sending') : t('sendCode')}
      </Button>
    </div>
  );
}
