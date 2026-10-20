'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { SelectControlOption } from '@/components/ui/select-control';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import type { ContractLineOption, ContractLineOptionsPage, LineSearchRequest } from '@/lib/contracts/queries';
import { pickLocale } from '@/lib/i18n/pick-locale';

/** The server action a picker asks: each one gates its own surface (the variation form, the cost entry form). */
export type LineSearch = (request: LineSearchRequest) => Promise<ActionResult & { data?: ContractLineOptionsPage }>;

/** How long typing rests before the server is asked: one request per pause. */
const SEARCH_PAUSE_MS = 200;

interface Answer {
  query: string;
  lines: ContractLineOption[];
  hasMore: boolean;
  failure: string | null;
}

/** What a line reads as in the picker: its description, then its section. */
function optionLabel(line: ContractLineOption, locale: string): string {
  const text = (ar: string | null, en: string | null) => pickLocale({ nameAr: ar, nameEn: en }, 'name', locale).value;
  const description = text(line.descriptionAr, line.descriptionEn) || line.id.slice(0, 8);
  const section = text(line.sectionTitleAr, line.sectionTitleEn);
  return section ? `${description} (${section})` : description;
}

/** The next answer for `query`: the lines after `shown`, appended. A failure keeps `shown`. */
function askAfter(
  search: LineSearch,
  contractId: string,
  query: string,
  shown: ContractLineOption[],
  describe: (failure: ShownFailure) => string,
): Promise<Answer> {
  const afterLineId = shown.length > 0 ? shown[shown.length - 1].id : null;
  const failed = (failure: ShownFailure): Answer => ({ query, lines: shown, hasMore: shown.length > 0, failure: describe(failure) });
  return search({ contractId, query, afterLineId }).then(
    (result) =>
      result.ok && result.data
        ? { query, lines: [...shown, ...result.data.lines], hasMore: result.data.hasMore, failure: null }
        : failed(result),
    (rejection: unknown) => failed({ rejection }),
  );
}

/**
 * The contract lines a picker may name, asked of the server through `search`
 * (at most 50 per answer) for what is typed: the contract's lines from the start while
 * nothing is. "More results" asks for the next 50 after the last one shown, so
 * every line is reachable. An answer that lands after a newer question is
 * dropped; one "more" at a time.
 */
export function useBaselineLineSearch(search: LineSearch, contractId: string, query: string) {
  const te = useTranslations('errors');
  const t = useTranslations('contracts.lines');
  const locale = useLocale();
  // Read when an answer lands, so a new translator never re-asks the server.
  const describe = useRef((failure: ShownFailure) => describeReadFailure(failure, te, t('loadFailed')));
  useEffect(() => {
    describe.current = (failure) => describeReadFailure(failure, te, t('loadFailed'));
  });
  const latestAsked = useRef<string | null>(null);
  const moreInFlight = useRef(false);
  const [answer, setAnswer] = useState<Answer>({ query: '', lines: [], hasMore: false, failure: null });
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    latestAsked.current = query;
    const timer = setTimeout(
      () =>
        askAfter(search, contractId, query, [], describe.current).then(
          (next) => latestAsked.current === query && setAnswer(next),
        ),
      query.trim() === '' ? 0 : SEARCH_PAUSE_MS,
    );
    return () => clearTimeout(timer);
  }, [search, contractId, query]);

  function loadMore() {
    if (moreInFlight.current || answer.query !== query || !answer.hasMore) return;
    moreInFlight.current = true;
    setLoadingMore(true);
    askAfter(search, contractId, query, answer.lines, describe.current)
      .then((next) => latestAsked.current === next.query && setAnswer(next))
      .finally(() => {
        moreInFlight.current = false;
        setLoadingMore(false);
      });
  }

  const current = answer.query === query;
  return {
    /** The lines shown, for a picker that needs more of a line than its label (its section). */
    lines: answer.lines,
    options: answer.lines.map((line): SelectControlOption => ({ value: line.id, label: optionLabel(line, locale) })),
    hasMore: current && answer.hasMore,
    browsing: query.trim() === '',
    loadMore,
    loadingMore,
    failure: current ? answer.failure : null,
  };
}
