'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
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
import { VariationPaperDialog, type PaperAnswerOrder } from './variation-paper-dialog';

/** A cell: a table cell from sm up, a piece of the stacked row below it. */
const CELL = 'block sm:table-cell sm:px-4 sm:py-2';

const rowId = (orderId: string) => `variation-row-${orderId}`;
const paperButtonId = (orderId: string) => `variation-paper-open-${orderId}`;

/**
 * Where the caret goes once the paper dialog of `orderId` is gone: back to the
 * row's paper button, or to the row itself when the button is no longer there
 * (the answer was recorded, or the client answered online meanwhile).
 */
function returnFocusToRow(orderId: string, answered: boolean): void {
  const button = answered ? null : document.getElementById(paperButtonId(orderId));
  (button ?? document.getElementById(rowId(orderId)))?.focus();
}

/**
 * The contract's variation orders, each with the next step its status allows.
 * On an execution contract (`chargeRates`) each also says what it charges the
 * client and the days it adds. An issued one may take the client's answer
 * given on paper (`canDecideOnPaper`: owner, admin, project manager), in one
 * dialog the table holds, so a re-read of the rows never takes it away.
 */
export function VariationTable({
  variations,
  chargeRates,
  canPriceVariation,
  canDecideOnPaper,
  pending,
  m,
  act,
}: {
  variations: VariationListRow[];
  chargeRates: VariationChargeRates | null;
  canPriceVariation: boolean;
  canDecideOnPaper: boolean;
  pending: boolean;
  m: (v: string) => string;
  act: ContractAction;
}) {
  const tv = useTranslations('variations');
  const locale = useLocale();
  const [paperOrder, setPaperOrder] = useState<PaperAnswerOrder | null>(null);

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
    <>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {/* Below sm each row stacks as a card (F3): number, then the title and
              its breakdown across the full width, then status, net change and the
              next step, so nothing is pushed off a phone screen. */}
          <table className="block w-full text-body sm:table">
            <tbody className="block sm:table-row-group">
              {variations.map((v) => {
                const statusKey = variationStatusKey(v);
                const number = formatDocNumber('VO', v.number, docYear(null, v.createdAt));
                return (
                  <tr
                    key={v.id}
                    id={rowId(v.id)}
                    tabIndex={-1}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3 outline-none last:border-0 focus-ring-brand sm:table-row sm:p-0"
                  >
                    <td className={`${CELL} whitespace-nowrap font-mono text-caption`} dir="ltr">
                      {number}
                    </td>
                    <td className={`${CELL} basis-full`}>
                      {pickLocale({ nameAr: v.titleAr, nameEn: v.titleEn }, 'name', locale).value}
                      {chargeRates && (
                        <VariationChargeSummary
                          netDelta={v.netDelta}
                          status={v.status}
                          timeExtensionDays={v.timeExtensionDays}
                          rates={chargeRates}
                          m={m}
                        />
                      )}
                    </td>
                    <td className={CELL}>
                      <StatusChip tone={VARIATION_STATUS_TONE[statusKey]} label={tv(`status.${statusKey}`)} />
                    </td>
                    <td className={`${CELL} ms-auto whitespace-nowrap text-end sm:ms-0`} dir="ltr">
                      {m(v.netDelta)}
                    </td>
                    <td className={`${CELL} text-end`}>
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
                      {canDecideOnPaper && v.status === 'issued' && (
                        <Button id={paperButtonId(v.id)} variant="secondary" size="sm" onClick={() => setPaperOrder({ id: v.id, number })}>
                          {tv('paper.open')}
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
      {paperOrder && (
        <VariationPaperDialog
          key={paperOrder.id}
          order={paperOrder}
          onClose={() => setPaperOrder(null)}
          returnFocus={(answered) => returnFocusToRow(paperOrder.id, answered)}
        />
      )}
    </>
  );
}
