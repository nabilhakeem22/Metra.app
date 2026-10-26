'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useClientUnitName } from '@/components/share/use-client-unit-name';
import type { PublicContractLine } from '@/lib/contracts/public-types';
import { formatMoney } from '@/lib/format/money';
import { formatQuantity } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';

// One layout per width of the LIST (a container query, so the home's side
// column stacks too, not only a phone): from 36rem a line is a table row of
// four cells; narrower, the description takes the row and the quantity and
// the unit price stack under it, the line total beside them.
const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b px-4 py-2 last:border-0 [@container(min-width:36rem)]:table-row';
const WIDE_CELL = '[@container(min-width:36rem)]:px-4 [@container(min-width:36rem)]:py-2';

/**
 * One line of a client's contract: its item code, description and the
 * provisional mark; the quantity at up to 4 decimals with its unit named in
 * the client's language (never the stored code); the unit price; the line
 * total. فصحى copy, Latin digits.
 */
export function ContractLineRow({ line }: { line: PublicContractLine }) {
  const t = useTranslations('portal.contract.lines');
  const locale = useLocale();
  const unitName = useClientUnitName();
  const description = pickLocale({ textAr: line.description_ar, textEn: line.description_en }, 'text', locale).value;

  return (
    <tr className={ROW}>
      <td className={`col-span-2 ${WIDE_CELL}`}>
        {/* The code's own direction stays inside; the gap after it follows the page's. */}
        {line.item_code && (
          <span className="me-2 text-muted-foreground">
            <span dir="ltr">{line.item_code}</span>
          </span>
        )}
        {description}
        {line.provisional && <span className="ms-2 text-caption text-muted-foreground">{t('provisional')}</span>}
      </td>
      <td className={`justify-self-start whitespace-nowrap text-muted-foreground ${WIDE_CELL}`}>
        <span dir="ltr" className="tabular-nums">
          {formatQuantity(line.qty, locale)}
        </span>{' '}
        {unitName(line.unit)}
      </td>
      {/* Stacked, the "×" leads in the page's direction; as a table cell, the figure sits as the total's does (LTR, at its end). */}
      <td className={`col-start-1 row-start-3 justify-self-start whitespace-nowrap text-end font-mono tabular-nums [@container(min-width:36rem)]:[direction:ltr] ${WIDE_CELL}`}>
        <span aria-hidden className="text-muted-foreground [@container(min-width:36rem)]:hidden">× </span>
        <span dir="ltr">{formatMoney(line.unit_price, locale)}</span>
      </td>
      <td className={`col-start-2 row-span-2 row-start-2 self-center whitespace-nowrap text-end font-mono tabular-nums ${WIDE_CELL}`} dir="ltr">
        {formatMoney(line.line_total, locale)}
      </td>
    </tr>
  );
}
