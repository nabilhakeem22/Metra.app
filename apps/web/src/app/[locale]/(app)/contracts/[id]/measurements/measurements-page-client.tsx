'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/status-chip';
import type { MeasurementContractView } from '@/lib/execution/measurements/contract-view';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { CONTRACT_STATUS_TONE } from '@/lib/ui/record-status-tones';
import { MeasurementsTab } from '../measurements-tab';

/** The measurements page: the contract named (title, client, status, no money), then its lines. */
export function MeasurementsPageClient({ header, canRecord }: { header: MeasurementContractView; canRecord: boolean }) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const title = pickLocale({ nameAr: header.titleAr, nameEn: header.titleEn }, 'name', locale).value;
  const client = pickLocale({ nameAr: header.clientNameAr, nameEn: header.clientNameEn }, 'name', locale).value;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-body">
          <StatusChip tone={CONTRACT_STATUS_TONE[header.status]} label={t(`status.${header.status}`)} />
          {title && <span className="font-medium">{title}</span>}
          {client && (
            <span className="text-muted-foreground">
              {t('client')}: {client}
            </span>
          )}
        </CardContent>
      </Card>
      <MeasurementsTab contractId={header.id} canRecord={canRecord} />
    </div>
  );
}
