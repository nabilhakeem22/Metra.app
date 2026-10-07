'use client';

import { Copy, Loader2, Mail, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { dirFor, LOCALES } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { whatsappUrl } from '@/lib/engagements/reminder/whatsapp';
import { cn } from '@/lib/utils';
import type { DeliveryReminderApi } from './use-delivery-reminder';
import type { DeliveryReminder } from '@/lib/engagements/reminder/prepare';

/**
 * The reminder, ready to go: the language, the message as the client will read
 * it, then WhatsApp (the filled action, a real link so no popup blocker stands
 * in the way), copy, and email. Nothing here writes to Metra; "Open WhatsApp"
 * hands the text to the studio's own WhatsApp and the studio presses send.
 */
export function DeliveryReminderReady({
  api,
  reminder,
}: {
  api: DeliveryReminderApi;
  reminder: DeliveryReminder;
}) {
  const t = useTranslations('engagements.reminder');
  const terrors = useTranslations('errors');
  const message = reminder.messages[api.locale];

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('language')} className="flex gap-1.5">
        {LOCALES.map((locale) => (
          <Button
            key={locale}
            type="button"
            variant={locale === api.locale ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={locale === api.locale}
            onClick={() => api.setLocale(locale)}
          >
            {t(`locale.${locale}`)}
          </Button>
        ))}
      </div>

      <figure className="space-y-1">
        <figcaption className="text-caption text-[color:var(--text-muted)]">{t('preview')}</figcaption>
        <p
          dir={dirFor(api.locale)}
          className="whitespace-pre-wrap break-words rounded-item border bg-background p-3 text-small"
        >
          {message}
        </p>
      </figure>

      <Button asChild variant="default" className="w-full">
        <a
          data-primary-action=""
          href={whatsappUrl(reminder.whatsappDigits, message)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle className="size-4" aria-hidden />
          {t('openWhatsapp')}
        </a>
      </Button>
      {reminder.whatsappDigits === null && (
        <p className="text-caption text-[color:var(--text-muted)]">{t('noNumber')}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="secondary" onClick={api.copy}>
          <Copy className="size-4" aria-hidden />
          {api.copied ? t('copied') : t('copy')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={reminder.clientEmail === null || api.emailing}
          onClick={api.sendEmail}
        >
          {api.emailing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Mail className="size-4" aria-hidden />
          )}
          {t('email')}
        </Button>
      </div>
      <p
        className={cn(
          'text-caption',
          api.emailResult?.ok === false ? 'text-destructive' : 'text-[color:var(--text-muted)]',
        )}
        role={api.emailResult ? (api.emailResult.ok ? 'status' : 'alert') : undefined}
      >
        {api.emailResult
          ? api.emailResult.ok
            ? t('emailSent')
            : resolveActionError(api.emailResult.error, terrors)
          : reminder.clientEmail === null
            ? t('noEmail')
            : t('emailTo', { email: reminder.clientEmail })}
      </p>
    </div>
  );
}
