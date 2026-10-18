'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { SelectControlOption } from '@/components/ui/select-control';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { searchBaselineLines } from '@/lib/contracts/lines-actions';
import type { ContractLinesPage } from '@/lib/contracts/queries';
import { pickLocale } from '@/lib/i18n/pick-locale';

/** How long typing rests before the server is asked: one request per pause. */
const SEARCH_PAUSE_MS = 200;

interface Answer {
  query: string;
  page: ContractLinesPage | null;
  failure: string | null;
}

/**
 * The contract lines a variation line may name, asked of the server (at most
 * 50 per answer) for what is typed: the contract's first lines while nothing
 * is. An answer that lands after a newer question is dropped.
 */
export function useBaselineLineSearch(contractId: string, query: string) {
  const te = useTranslations('errors');
  const locale = useLocale();
  // Read when an answer lands, so a new translator never re-asks the server.
  const translate = useRef(te);
  useEffect(() => {
    translate.current = te;
  });
  const latestAsked = useRef<string | null>(null);
  const [answer, setAnswer] = useState<Answer>({ query: '', page: null, failure: null });

  useEffect(() => {
    latestAsked.current = query;
    const settle = (page: ContractLinesPage | null, failure: string | null) => {
      if (latestAsked.current === query) setAnswer({ query, page, failure });
    };
    const ask = () =>
      searchBaselineLines({ contractId, query }).then(
        (result) => {
          if (result.ok && result.data) settle(result.data, null);
          else settle(null, describeFailure(result, translate.current));
        },
        (rejection: unknown) => settle(null, describeRejection(rejection, translate.current)),
      );
    const timer = setTimeout(ask, query.trim() === '' ? 0 : SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [contractId, query]);

  const options: SelectControlOption[] = (answer.page?.lines ?? []).map((line) => ({
    value: line.id,
    label:
      pickLocale({ nameAr: line.descriptionAr, nameEn: line.descriptionEn }, 'name', locale).value ||
      line.id.slice(0, 8),
  }));
  return { options, capped: answer.page?.hasMore ?? false, failure: answer.failure };
}
