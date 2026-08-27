'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Channel } from './login-form';

// The OTP request step: channel toggle + identifier field + send button. All
// state and the send handler live in the parent (LoginForm); this child is
// presentational, driven by the passed value + callbacks.
export function LoginRequestStep({
  t,
  th,
  channel,
  switchChannel,
  identifier,
  setIdentifier,
  send,
  busy,
  sending,
}: {
  t: ReturnType<typeof useTranslations<'login'>>;
  th: ReturnType<typeof useTranslations<'hints.auth'>>;
  channel: Channel;
  switchChannel: (next: Channel) => void;
  identifier: string;
  setIdentifier: (value: string) => void;
  send: () => void;
  busy: boolean;
  sending: boolean;
}) {
  return (
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
        <Label htmlFor="identifier" className="flex items-center">
          {channel === 'email' ? t('emailLabel') : t('phoneLabel')}
          <FieldHint id="identifier-hint" hint={th('email')} />
        </Label>
        <Input
          id="identifier"
          type={channel === 'email' ? 'email' : 'tel'}
          dir="ltr"
          aria-describedby="identifier-hint"
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
        className="h-11 w-full"
        onClick={send}
        disabled={busy || identifier.trim().length === 0}
      >
        {sending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {sending ? t('sending') : t('sendCode')}
      </Button>
    </div>
  );
}
