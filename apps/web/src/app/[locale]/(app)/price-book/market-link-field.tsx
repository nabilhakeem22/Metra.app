'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectControl } from '@/components/ui/select-control';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { formatMoney } from '@/lib/format/money';
import { linkCostItemToMarket } from '@/lib/market-book/actions';
import type { MarketPriceRef } from '@/lib/market-book/types';
import { useMarketLinkSearch } from './use-market-link-search';

const NOT_PICKED = '__not_picked__';
const FIND_ID = 'ci-market-find';
const PICK_ID = 'ci-market';

const inLocale = (locale: string, ar: string, en: string) => (locale.startsWith('ar') ? ar : en);

/**
 * "Linked market item" (market plan C7): which official guide item this cost
 * item follows. Picking one links it at once and unlinking is one button; it
 * saves on its own, apart from the sheet's Save, and never changes the cost
 * or the price. Only items in the item's own unit are offered. A refusal is
 * said under the picker. What was saved is said IN the field, not as a toast:
 * a toast over the sheet would cover its footer and take the first Escape.
 * `linked` and `reference` are the page's latest read, so the field says the
 * link as it now stands.
 */
export function MarketLinkField({ costItemId, linked, reference }: { costItemId: string; linked: boolean; reference: MarketPriceRef | undefined }) {
  const t = useTranslations('priceBook.market');
  const tm = useTranslations('marketBook');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const search = useMarketLinkSearch(costItemId, query);
  const current = reference
    ? `${inLocale(locale, reference.nameAr, reference.nameEn)} (${inLocale(locale, reference.unitLabelAr, tm(`units.${reference.unit}`))})`
    : t(linked ? 'noPrice' : 'link.none');

  function link(marketItemId: string | null) {
    setRefusal(null);
    setSaved(null);
    startTransition(async () => {
      try {
        const result = await linkCostItemToMarket({ costItemId, marketItemId });
        if (result.ok) setSaved(t(marketItemId ? 'link.linked' : 'link.unlinked'));
        else setRefusal(describeFailure(result, te));
      } catch (rejection) {
        setRefusal(describeRejection(rejection, te));
      }
    });
  }

  const errorId = `${PICK_ID}-error`;
  const searchErrorId = `${FIND_ID}-error`;
  return (
    <section className="space-y-2 rounded-item border p-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body">
        <span>
          <span className="text-muted-foreground">{t('link.label')}: </span>
          {current}
          <span role="status" className="ms-2 text-caption text-muted-foreground">
            {saved}
          </span>
        </span>
        {linked && (
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => link(null)}>
            {t('link.unlink')}
          </Button>
        )}
      </div>
      <p className="text-caption text-muted-foreground">{t('link.hint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={FIND_ID}>{t('link.find')}</Label>
          <Input
            id={FIND_ID}
            className="w-48"
            value={query}
            aria-invalid={search.failure ? true : undefined}
            aria-describedby={search.failure ? searchErrorId : undefined}
            onChange={(event) => setQuery(event.target.value)}
          />
          {search.failure && (
            <p id={searchErrorId} className="text-caption text-destructive">
              {search.failure}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor={PICK_ID}>{t('link.pick')}</Label>
          <SelectControl
            id={PICK_ID}
            className="h-9 w-auto min-w-48"
            value={NOT_PICKED}
            disabled={pending}
            aria-invalid={refusal ? true : undefined}
            aria-describedby={refusal ? errorId : undefined}
            onValueChange={(value) => value !== NOT_PICKED && link(value)}
            options={[
              { value: NOT_PICKED, label: search.answered && search.items.length === 0 ? t('link.noMatch') : t('link.pick') },
              ...search.items.map((item) => ({
                value: item.id,
                label: `${inLocale(locale, item.nameAr, item.nameEn)} (${inLocale(locale, item.leafNameAr, item.leafNameEn)})${item.unitCost ? ` ${formatMoney(item.unitCost, locale)}` : ''}`,
              })),
            ]}
          />
          {refusal && (
            <p id={errorId} className="text-caption text-destructive">
              {refusal}
            </p>
          )}
        </div>
        {pending && <Loader2 className="mb-2 size-4 animate-spin" aria-hidden />}
      </div>
      {search.more && <p className="text-caption text-muted-foreground">{t('link.more')}</p>}
    </section>
  );
}
