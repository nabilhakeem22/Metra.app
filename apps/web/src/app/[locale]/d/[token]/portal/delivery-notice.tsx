'use client';

import { useTranslations } from 'next-intl';
import { Wordmark } from '@/components/brand/wordmark';
import { LanguageSwitch } from './language-switch';

/**
 * What a client sees when no delivery could be shown, in a card with the Metra
 * mark and the language switch (the token is in the path, so the switch works
 * here too). Which notice matters: `notFound` is permanent and tells the client
 * to ask their design team for a new link; `readFailed` is transient and tells
 * them their link is still valid.
 */
export function DeliveryNotice({
  notice,
  token,
  locale,
}: {
  notice: 'notFound' | 'readFailed';
  token: string;
  locale: string;
}) {
  const t = useTranslations(`delivery.${notice}`);
  return (
    <div className="client-portal flex min-h-screen items-center justify-center p-4">
      <section className="w-full max-w-sm space-y-4 rounded-panel border bg-background p-6 text-center shadow-sm">
        <div className="flex justify-center">
          <Wordmark size="md" />
        </div>
        <div className="space-y-2">
          <h1 className="text-title font-semibold">{t('title')}</h1>
          <p className="text-body text-muted-foreground">{t('body')}</p>
        </div>
        <LanguageSwitch token={token} locale={locale} />
      </section>
    </div>
  );
}
