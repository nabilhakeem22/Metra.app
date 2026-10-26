'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MilestoneProgress } from '@/lib/engagements/journey-map';
import { JourneyTracker } from './journey-tracker';

/**
 * The top of the DESIGN RECORD, the design tab once the delivery is at
 * execution: the design phase is complete, the journey is drawn with every
 * step done, and the page below is a record. It replaces the command card
 * there, so no calm hero says "delivered" over "in construction" any more (the
 * B4 /d defect). Payments are read-only by then (the design snapshot offers
 * no claim at execution); documents and their comments keep working (OD6).
 */
export function DesignRecordBanner({ milestone }: { milestone: MilestoneProgress }) {
  const t = useTranslations('delivery.home.record');
  return (
    <section aria-labelledby="design-record-title" className="space-y-4 rounded-panel border border-[color:var(--success)]/30 bg-background p-4 shadow-sm">
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
      <JourneyTracker milestone={milestone} bare />
    </section>
  );
}
