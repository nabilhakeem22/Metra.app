'use client';

import { Eye } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import { portalErrorKey, type PortalErrorKey } from '@/lib/engagements/portal-error-key';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { chooseDeliveryConcept, recordDeliveryAction, type DeliveryActResult } from '../actions';
import { HeroConfirmed, type HeroOutcome } from './hero-confirmed';

type ConceptOption = PublicDelivery['conceptOptions'][number];

type Confirmed = { outcome: HeroOutcome; studioNotified: boolean; chosenLetter?: string };

/**
 * The concept review as a CHOICE (Round B, B12): one card per released option,
 * lettered A to D by the database, each with "View" (new tab) and "Choose this
 * option", which asks first (Cancel calls nothing). The letter the client saw is
 * sent and saved; if the studio changed the options meanwhile it no longer
 * matches, so the client is told and the page refreshes. "Request changes" stays.
 */
export function ConceptOptionPicker({ token, options }: { token: string; options: ConceptOption[] }) {
  const t = useTranslations('delivery.conceptPicker');
  const tHero = useTranslations('delivery.hero');
  const tGroup = useTranslations('delivery.hero.concept');
  const tActions = useTranslations('delivery.actions');
  const locale = useLocale();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  // A portal error, or 'changed': the options moved under the client.
  const [error, setError] = useState<PortalErrorKey | 'changed' | null>(null);

  function run(act: () => Promise<DeliveryActResult>, outcome: HeroOutcome, chosenLetter?: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await act();
        if (result.ok) {
          setConfirmed({ outcome, studioNotified: result.studioNotified === true, chosenLetter });
        } else if (chosenLetter && result.error === 'wrong_state') {
          setError('changed');
          router.refresh();
        } else {
          setError(portalErrorKey(result.error));
        }
      } catch {
        setError('generic');
      }
    });
  }

  async function choose(option: ConceptOption) {
    const letter = bidiIsolate(option.letter);
    const accepted = await confirm({
      title: t('confirmTitle', { letter }),
      description: t('confirmBody'),
      confirmLabel: t('confirm', { letter }),
      cancelLabel: t('cancel'),
    });
    if (!accepted) return;
    run(() => chooseDeliveryConcept(token, option.id, option.position, note), 'approved', option.letter);
  }

  if (confirmed) {
    return (
      <HeroConfirmed
        group="concept"
        outcome={confirmed.outcome}
        studioNotified={confirmed.studioNotified}
        chosenLetter={confirmed.chosenLetter}
      />
    );
  }

  return (
    <section className="space-y-3 rounded-panel border-2 border-primary/25 bg-background p-5 shadow-md">
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-primary/10 px-2.5 py-1 text-caption font-bold text-primary ltr:uppercase ltr:tracking-wide">
        <span aria-hidden>●</span>
        {tHero('readyTag')}
      </span>
      <h2 className="text-heading font-semibold">{t('title')}</h2>
      <p className="text-body text-muted-foreground">{t('body')}</p>
      <ul className="space-y-2">
        {options.map((option) => (
          <li
            key={option.id}
            data-concept-option={option.letter}
            className="flex flex-wrap items-center gap-2 rounded-item border p-3"
          >
            <span id={`concept-option-${option.id}`} className="text-body font-semibold">
              {t('option', { letter: bidiIsolate(option.letter) })}
            </span>
            <a
              href={`/${locale}/d/${encodeURIComponent(token)}/documents/${option.id}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={`concept-option-${option.id}`}
              className="ms-auto inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-caption font-semibold hover:bg-muted coarse:min-h-11"
            >
              <Eye className="size-3.5" aria-hidden />
              {t('view')}
            </a>
            <Button
              variant="default"
              size="sm"
              disabled={pending}
              aria-describedby={`concept-option-${option.id}`}
              onClick={() => void choose(option)}
            >
              {t('choose')}
            </Button>
          </li>
        ))}
      </ul>
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        rows={2}
        dir="auto"
        placeholder={tActions('notePlaceholder')}
      />
      <Button
        variant="ghost"
        className="w-full"
        disabled={pending}
        onClick={() => run(() => recordDeliveryAction(token, 'request_concept_changes', note), 'changes')}
      >
        {tGroup('changes')}
      </Button>
      {error && (
        <p className="text-body text-destructive" role="alert">
          {error === 'changed' ? t('changed') : tActions(`error.${error}`)}
        </p>
      )}
      {dialog}
    </section>
  );
}
