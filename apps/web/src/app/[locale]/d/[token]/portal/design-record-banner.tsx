'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StepCard } from '@/components/flow/step-card';
import { commandCardChromeForTone } from '@/lib/engagements/command-card-chrome';
import { buildPhaseView } from '@/lib/flow/build-view';
import { locateDesignForClient, type ClientDesignFacts } from '@/lib/flow/locate/design-client';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';
import { DesignRail } from './design-rail';

/**
 * The top of the DESIGN RECORD, the design tab once the delivery is at
 * execution: the shared step card with every step of the rail done, and the page
 * below is a record. It replaces the command card there, so no calm hero says
 * "delivered" over "in construction" any more (the B4 /d defect). Payments are
 * read-only by then (the design snapshot offers no claim at execution); documents
 * and their comments keep working (OD6).
 */
export function DesignRecordBanner({ delivery }: { delivery: ClientDesignFacts }) {
  const t = useTranslations('delivery.home.record');
  const view = buildPhaseView(DESIGN_PHASE, locateDesignForClient(delivery), 'client');
  return (
    <section aria-labelledby="design-record-title">
      <StepCard chrome={commandCardChromeForTone('done')} rail={<DesignRail view={view} />}>
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--success-tint)] text-[color:var(--success)]">
            <Check className="size-4" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <h2 id="design-record-title" className="text-body font-semibold">
              {t('title')}
            </h2>
            <p className="text-caption text-muted-foreground">{t('body')}</p>
          </div>
        </div>
      </StepCard>
    </section>
  );
}
