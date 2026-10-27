'use client';

import { Loader2, MessageCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CODE_LENGTH, type CodeLimit } from '@/lib/client-home/code-answers';
import { bidiIsolate } from '@/lib/format/bidi';
import { pluralParams } from '@/lib/format/plural-params';
import { describePortalFailure } from '@/lib/share/portal-failure';
import { waitParts } from './code-time';
import type { ClientCode, CodeNotice } from './use-client-code';

/** The sentence each limit has (H5 functional F4): the client's own act, their page, the studio, the service, the link, the contract. */
const LIMIT_COPY: Readonly<Record<CodeLimit, string>> = {
  target_spacing: 'spacing',
  target_hour: 'target',
  target_tries: 'target',
  delivery_day: 'delivery',
  studio_day: 'studio',
  platform_day: 'service',
  link_minute: 'link',
  claims_hour: 'claims',
};

/** The limits on the act's own subject: their sentence names it (this payment, this contract). */
const ACT_LIMITS: ReadonlySet<CodeLimit> = new Set(['target_spacing', 'target_hour', 'target_tries']);

/** A wait in words: a ticking M:SS under an hour, hours and minutes from an hour on (never "1319:54"). */
function useWaitText() {
  const t = useTranslations('delivery.code.wait');
  const locale = useLocale();
  return (seconds: number): string => {
    const parts = waitParts(seconds);
    if (parts.kind === 'clock') return bidiIsolate(parts.text);
    const hours = t('hours', pluralParams('hours', 'hoursText', parts.hours, locale));
    if (parts.minutes === 0) return hours;
    return t('hoursAndMinutes', { hours, minutes: t('minutes', pluralParams('minutes', 'minutesText', parts.minutes, locale)) });
  };
}

/** The panel's sentence for what went wrong; a limit's names the limit and its wait as it runs. */
function useNoticeText(studio: string, act: ClientCode['act']) {
  const t = useTranslations('delivery.code');
  const tErrors = useTranslations('portal.errors');
  const locale = useLocale();
  const waitText = useWaitText();
  return (notice: CodeNotice, noticeSeconds: number): string => {
    switch (notice.error) {
      case 'portal':
        return describePortalFailure(notice.failure, tErrors);
      case 'code_wrong':
        return t('error.code_wrong', pluralParams('left', 'leftText', notice.attemptsLeft, locale));
      case 'too_many': {
        const copy = LIMIT_COPY[notice.limit];
        return t(ACT_LIMITS.has(notice.limit) ? `tooMany.${copy}.${act}` : `tooMany.${copy}`, { studio, wait: waitText(noticeSeconds) });
      }
      default:
        return t(`error.${notice.error}`, { studio });
    }
  };
}

/**
 * The one-time code step of an act that binds the client ("I paid", signing
 * the contract), shared by every such act and worded for it (`code.act`):
 * where the code will go, [Send the code] and [I already have a code], then
 * the six-digit box (Arabic-Indic digits become Latin as they are typed) with
 * a new code offered once the wait is over, and what went wrong in the
 * panel's own words. The box takes the code from the LATEST email, whether it
 * was asked for here or before a reload (H5 functional F1). A client with no
 * address on file is told so plainly, with the studio's WhatsApp, and no box
 * is shown: the studio records the payment, or the contract is signed on
 * paper, instead. The act's own Confirm is the caller's (it sends
 * `code.proof()`). فصحى copy, Latin digits, logical CSS only.
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
  const noticeText = useNoticeText(studioName, code.act);
  const waitText = useWaitText();

  if (code.noChannel) {
    return (
      <div className="space-y-3" data-code-panel="no_channel">
        <p role="status" className="text-body text-foreground">
          {t(`noChannel.${code.act}`, { studio: studioName })}
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

  // A limit's notice already says its wait as it runs; the countdown line would repeat it.
  const waiting =
    code.waitSeconds > 0 && code.notice?.error !== 'too_many' ? (
      <p className="text-caption text-muted-foreground" data-code-wait>
        {t('resendIn', { time: waitText(code.waitSeconds) })}
      </p>
    ) : null;
  const sendButton = (label: string, variant: 'secondary' | 'ghost') => (
    <Button
      type="button"
      variant={variant}
      size={variant === 'ghost' ? 'sm' : 'default'}
      className={variant === 'ghost' ? undefined : 'min-h-11 w-full'}
      disabled={code.requesting || code.waitSeconds > 0}
      onClick={code.request}>
      {code.requesting && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {label}
    </Button>
  );

  return (
    <div className="space-y-3 rounded-item border bg-muted/40 p-3" data-code-panel={code.typing ? 'box' : 'ask'}>
      {code.typing ? (
        <>
          <p className="text-body text-foreground">
            {code.sentHere
              ? t('sent', { hint: bidiIsolate(code.hint ?? '') })
              : code.hint
                ? t('typing', { hint: bidiIsolate(code.hint) })
                : t('typingOnFile', { studio: studioName })}
          </p>
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
          {waiting ?? sendButton(t('resend'), 'ghost')}
        </>
      ) : (
        <>
          <p className="text-body text-foreground">
            {code.hint ? t('intro', { hint: bidiIsolate(code.hint) }) : t('introOnFile', { studio: studioName })}
          </p>
          {sendButton(t('send'), 'secondary')}
          {waiting}
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={code.haveCode}>
            {t('haveCode')}
          </Button>
        </>
      )}
      {code.notice && (
        <p id={noticeId} role="alert" className="text-caption text-destructive">
          {noticeText(code.notice, code.noticeSeconds)}
        </p>
      )}
    </div>
  );
}
