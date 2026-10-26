'use client';

import { Loader2, MessageCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CODE_LENGTH } from '@/lib/client-home/code-answers';
import { bidiIsolate } from '@/lib/format/bidi';
import { pluralParams } from '@/lib/format/plural-params';
import { describePortalFailure } from '@/lib/share/portal-failure';
import { countdownText, waitUnit } from './code-time';
import type { ClientCode, CodeNotice } from './use-client-code';

/** The panel's sentence for what went wrong. */
function useNoticeText(studio: string) {
  const t = useTranslations('delivery.code');
  const tErrors = useTranslations('portal.errors');
  const locale = useLocale();
  return (notice: CodeNotice): string => {
    switch (notice.error) {
      case 'portal':
        return describePortalFailure(notice.failure, tErrors);
      case 'code_wrong':
        return t('error.code_wrong', pluralParams('left', 'leftText', notice.attemptsLeft, locale));
      case 'too_many': {
        const { unit, count } = waitUnit(notice.retryAfterSeconds);
        const wait = unit === 'minutes' ? t('wait.minutes', pluralParams('minutes', 'minutesText', count, locale)) : t('wait.hours', pluralParams('hours', 'hoursText', count, locale));
        return t('error.too_many', { wait });
      }
      default:
        return t(`error.${notice.error}`, { studio });
    }
  };
}

/**
 * The one-time code step of an act that binds the client ("I paid"), shared by
 * every such act: where the code will go and [Send the code], then the
 * six-digit box (Arabic-Indic digits become Latin as they are typed) with a new
 * code offered once the wait is over, and what went wrong in the panel's own
 * words. A client with no address on file is told so plainly, with the
 * studio's WhatsApp, and no box is shown: the studio records it instead. The
 * act's own Confirm is the caller's (it sends `code.proof()`). فصحى copy,
 * Latin digits, logical CSS only.
 */
export function ClientCodePanel({
  code,
  studioName,
  whatsappHref,
}: {
  code: ClientCode;
  studioName: string;
  /** The studio's WhatsApp, prefilled, or null when the studio set none. */
  whatsappHref: string | null;
}) {
  const t = useTranslations('delivery.code');
  const tHome = useTranslations('delivery.home');
  const boxId = useId();
  const noticeId = useId();
  const noticeText = useNoticeText(studioName);

  if (code.noChannel) {
    return (
      <div className="space-y-3" data-code-panel="no_channel">
        <p role="status" className="text-body text-foreground">
          {t('noChannel', { studio: studioName })}
        </p>
        {whatsappHref && (
          <Button asChild variant="secondary" className="min-h-11 w-full">
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden />
              {tHome('act.whatsapp', { studio: studioName })}
            </a>
          </Button>
        )}
      </div>
    );
  }

  const waiting = code.waitSeconds > 0 ? <p className="text-caption text-muted-foreground">{t('resendIn', { time: bidiIsolate(countdownText(code.waitSeconds)) })}</p> : null;

  return (
    <div className="space-y-3 rounded-item border bg-muted/40 p-3" data-code-panel={code.sent ? 'sent' : 'ask'}>
      {code.sent ? (
        <>
          <p className="text-body text-foreground">{t('sent', { hint: bidiIsolate(code.hint ?? '') })}</p>
          <div className="space-y-1.5">
            <Label htmlFor={boxId}>{t('label')}</Label>
            <Input
              id={boxId}
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              maxLength={CODE_LENGTH * 2}
              value={code.value}
              onChange={(event) => code.type(event.target.value)}
              aria-invalid={code.notice !== null ? true : undefined}
              aria-describedby={code.notice !== null ? noticeId : undefined}
              className="h-12 text-center font-mono text-title tracking-[0.5em] tabular-nums"
            />
          </div>
          {waiting ?? (
            <Button type="button" variant="ghost" size="sm" disabled={code.requesting} onClick={code.request}>
              {code.requesting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('resend')}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-body text-foreground">
            {code.hint ? t('intro', { hint: bidiIsolate(code.hint) }) : t('introOnFile', { studio: studioName })}
          </p>
          <Button type="button" variant="secondary" className="min-h-11 w-full" disabled={code.requesting || code.waitSeconds > 0} onClick={code.request}>
            {code.requesting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('send')}
          </Button>
          {waiting}
        </>
      )}
      {code.notice && (
        <p id={noticeId} role="alert" className="text-caption text-destructive">
          {noticeText(code.notice)}
        </p>
      )}
    </div>
  );
}
