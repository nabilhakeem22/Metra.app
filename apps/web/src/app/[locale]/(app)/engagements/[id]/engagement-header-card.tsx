'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import type { EngagementHeader } from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { StateBadge } from '../state-badge';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function EngagementHeaderCard({ header }: { header: EngagementHeader }) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const title =
    pickLocale({ nameAr: header.titleAr, nameEn: header.titleEn }, 'name', locale)
      .value || '—';
  const client =
    pickLocale({ nameAr: header.clientNameAr, nameEn: header.clientNameEn }, 'name', locale)
      .value || '—';
  const project =
    pickLocale({ nameAr: header.projectNameAr, nameEn: header.projectNameEn }, 'name', locale)
      .value || '—';

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <StateBadge state={header.state} showStage />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label={t('client')}>{client}</Field>
          <Field label={t('project')}>{project}</Field>
          <Field label={t('designFee')}>
            {header.designFee ? (
              <span dir="ltr">{formatMoney(header.designFee, locale)}</span>
            ) : (
              '—'
            )}
          </Field>
          <Field label={t('revisions')}>
            {t('revisionsUsed', { used: header.revisionCount, free: header.freeRevisionN })}
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          {header.offPlan && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t('offPlan')}
            </span>
          )}
          {header.asBuiltDue && (
            <span className="rounded-full bg-[color:var(--warn-tint)] px-2 py-0.5 text-xs text-[color:var(--warn)]">
              {t('asBuiltDue')}
            </span>
          )}
          {header.conceptLockedAt && (
            <span className="rounded-full bg-[color:var(--brand-tint)] px-2 py-0.5 text-xs text-[color:var(--brand-ink)]">
              {t('conceptLocked')}
            </span>
          )}
          {header.renderManifestHash && (
            <span
              className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
              dir="ltr"
              title={header.renderManifestHash}
            >
              {t('renderManifest')}: {header.renderManifestHash.slice(0, 10)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
