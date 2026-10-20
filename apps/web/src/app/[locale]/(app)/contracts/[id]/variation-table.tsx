'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/status-chip';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { pickLocale } from '@/lib/i18n/pick-locale';
// A PURE leaf, not the queries barrel: this is a 'use client' module and the
// derivation it needs is one function over two fields.
import { VARIATION_STATUS_TONE } from '@/lib/ui/record-status-tones';
import { internalApproveVariation, issueVariation } from '@/lib/variations/actions';
import type { VariationListRow } from '@/lib/variations/queries';
import { variationStatusKey } from '@/lib/variations/status-label';
import type { ContractAction, VariationChargeRates } from './contract-vo-types';
import { VariationChargeSummary } from './variation-charge-summary';

/**
 * The contract's variation orders, each with the next step its status allows.
 * On an execution contract (`chargeRates`) each also says what it charges the
 * client and the days it adds.
 */
export function VariationTable({
  variations,
  chargeRates,
  canPriceVariation,
  pending,
  m,
  act,
}: {
  variations: VariationListRow[];
  chargeRates: VariationChargeRates | null;
  canPriceVariation: boolean;
  pending: boolean;
  m: (v: string) => string;
  act: ContractAction;
}) {
  const tv = useTranslations('variations');
  const locale = useLocale();

  if (variations.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-body text-muted-foreground">
          {tv('empty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-body">
          <tbody>
            {variations.map((v) => {
              const statusKey = variationStatusKey(v);
              return (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono text-caption" dir="ltr">
                    {formatDocNumber('VO', v.number, docYear(null, v.createdAt))}
                  </td>
                  <td className="px-4 py-2">
                    {pickLocale({ nameAr: v.titleAr, nameEn: v.titleEn }, 'name', locale).value}
                    {chargeRates && (
                      <VariationChargeSummary
                        netDelta={v.netDelta}
                        timeExtensionDays={v.timeExtensionDays}
                        rates={chargeRates}
                        m={m}
                      />
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <StatusChip tone={VARIATION_STATUS_TONE[statusKey]} label={tv(`status.${statusKey}`)} />
                  </td>
                  <td className="px-4 py-2 text-end" dir="ltr">
                    {m(v.netDelta)}
                  </td>
                  <td className="px-4 py-2 text-end">
                    {canPriceVariation && v.status === 'draft' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => act(() => internalApproveVariation(v.id))}
                      >
                        {tv('internalApprove')}
                      </Button>
                    )}
                    {canPriceVariation && v.status === 'internal_approved' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending}
                        onClick={() => act(() => issueVariation(v.id))}
                      >
                        {tv('issue')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
