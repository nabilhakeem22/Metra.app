'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/status-chip';
import type { CostContractHeader } from '@/lib/execution/costs/types';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { CONTRACT_STATUS_TONE } from '@/lib/ui/record-status-tones';
import { CostsTab } from '../costs-tab';

/** The costs page: the contract named (title, client, status, no money), then its costs. */
export function CostsPageClient({
  header,
  canCreate,
  canPickCostItem,
}: {
  header: CostContractHeader;
  canCreate: boolean;
  canPickCostItem: boolean;
}) {
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
      <CostsTab
        contractId={header.id}
        contractStatus={header.status}
        canCreate={canCreate}
        canPickCostItem={canPickCostItem}
        m={(value) => formatMoney(value, locale)}
      />
    </div>
  );
}
