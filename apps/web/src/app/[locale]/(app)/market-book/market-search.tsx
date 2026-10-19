'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from '@/i18n/routing';
import { MARKET_SEARCH_MAX_LENGTH, marketBookSearch } from '@/lib/market-book/page-params';

/** A search across every category, run by the server when submitted (?q=); clearing it returns to the categories. */
export function MarketSearch({ query }: { query: string }) {
  const t = useTranslations('marketBook');
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [pending, startTransition] = useTransition();

  useEffect(() => setValue(query), [query]);

  const open = (typed: string) =>
    startTransition(() => router.push(`/market-book${marketBookSearch({ categoryKey: null, query: typed.trim() })}`));

  return (
    <form
      role="search"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        open(value);
      }}
    >
      <label htmlFor="market-search" className="sr-only">
        {t('search.label')}
      </label>
      <Input
        id="market-search"
        type="search"
        value={value}
        maxLength={MARKET_SEARCH_MAX_LENGTH}
        placeholder={t('search.placeholder')}
        onChange={(event) => setValue(event.target.value)}
        className="min-w-0 flex-1"
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        <Search className="size-4" aria-hidden />
        {t('search.submit')}
      </Button>
      {query !== '' && (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => open('')}>
          {t('search.clear')}
        </Button>
      )}
    </form>
  );
}
