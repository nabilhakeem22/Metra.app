'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PortalTimelineEntry } from '@/lib/engagements/public/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatPortalMoney } from './portal-money';
import { useMilestoneLabel } from './use-milestone-label';

/**
 * What one timeline entry says, in the page's language: a stage by its client
 * label, a decision in the second person ("You approved the final design"),
 * marked "(recorded by your designer)" when the studio recorded it for the
 * client, a payment by its name and amount. Every word is a catalog key built
 * from a CLIENT word the mapper produced, never from a machine key.
 */
export function useTimelineLine(): (entry: PortalTimelineEntry) => string {
  const tStage = useTranslations('delivery.stage');
  const t = useTranslations('delivery.timeline');
  const locale = useLocale();
  const milestoneLabel = useMilestoneLabel();
  return (entry) => {
    switch (entry.type) {
      case 'stage':
        return tStage(`${entry.stageKey}.label`);
      case 'payment':
        return t('payment', {
          milestone: milestoneLabel(entry.kind),
          amount: bidiIsolate(formatPortalMoney(entry.amount, locale)),
        });
      case 'decision': {
        const decision = t(`decision.${entry.decision}`, { letter: bidiIsolate(entry.letter ?? '') });
        return entry.byStudio ? t('recordedByStudio', { decision }) : decision;
      }
    }
  };
}
