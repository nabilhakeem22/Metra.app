'use client';

import { MessageCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EXECUTION_STEP_ICON } from '@/components/flow/execution-step-icons';
import { PhaseRail } from '@/components/flow/phase-rail';
import { StepCard } from '@/components/flow/step-card';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import { clientMoveKey, clientMoveTone, heroAct } from '@/lib/client-home/hero';
import type { HomeExecution } from '@/lib/client-home/types';
import { commandCardChromeForTone } from '@/lib/engagements/command-card-chrome';
import { whatsappUrl } from '@/lib/engagements/reminder/whatsapp';
import { buildPhaseView } from '@/lib/flow/build-view';
import { pluralParams } from '@/lib/format/plural-params';
import { EXECUTION_PHASE } from '@/lib/flow/phases/execution';
import { useExecutionHeadline } from './use-execution-headline';

/**
 * The Execution tab's HERO: the shared step card (components/flow/step-card.tsx)
 * on the client's side. Its band holds the five execution steps, the client's
 * names for them (on a phone, the compact rail: the steps' marks and the
 * current step's name); its body says whose move it is, the ONE thing the client is
 * told now (./use-execution-headline.ts) and the one act that answers it:
 * opening the section where it is done, or writing to the studio on WhatsApp
 * when only the studio can help. A change order whose link lapsed is said
 * here too, so the client is never left without a reason. فصحى copy.
 */
export function ExecutionHero({
  execution,
  firmName,
  whatsappDigits,
  deliveryRef,
}: {
  execution: HomeExecution;
  firmName: string;
  whatsappDigits: string | null;
  /** DE-YYYY-NNNN, the only thing a WhatsApp message to the studio names. */
  deliveryRef: string;
}) {
  const t = useTranslations('delivery.home');
  const tFlow = useTranslations('delivery.flow.execution');
  const tBar = useTranslations('delivery.studioBar.execution');
  const locale = useLocale();
  const { location } = execution;
  const headline = useExecutionHeadline(execution, firmName, locale);
  const act = heroAct(location.reason);
  const labels = Object.fromEntries(EXECUTION_PHASE.steps.map((step) => [step.key, tFlow(step.key)]));
  const tone = clientMoveTone(location);

  return (
    <StepCard
      chrome={commandCardChromeForTone(tone)}
      rail={<PhaseRail view={buildPhaseView(EXECUTION_PHASE, location, 'client')} labels={labels} icons={EXECUTION_STEP_ICON} compactBelowSm />}
    >
      <div className="space-y-3" data-client-reason={location.reason}>
        {/* It names the studio, whose name may be long: it wraps rather than run past the card. */}
        <StatusChip tone={tone} label={t(`move.${clientMoveKey(location)}`, { studio: firmName })} className="max-w-full whitespace-normal" />
        <h2 className="text-heading font-semibold leading-tight text-balance">{headline}</h2>
        {execution.lapsedVariationCount > 0 && (
          <p className="text-body text-muted-foreground">
            {t('lapsedChangeOrders', { ...pluralParams('count', 'countText', execution.lapsedVariationCount, locale), studio: firmName })}
          </p>
        )}
        {act?.kind === 'section' && (
          <Button asChild variant="default" size="lg" className="w-full">
            <a href={`#${act.section}`}>{t(`act.${act.label}`)}</a>
          </Button>
        )}
        {act?.kind === 'whatsapp' && whatsappDigits && (
          <Button asChild variant="default" size="lg" className="w-full">
            <a href={whatsappUrl(whatsappDigits, tBar('whatsappText', { ref: deliveryRef }))} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden />
              {t('act.whatsapp', { studio: firmName })}
            </a>
          </Button>
        )}
      </div>
    </StepCard>
  );
}
