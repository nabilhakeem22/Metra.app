'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import { loadCostSections } from '@/lib/execution/costs/actions';
import type { CostSection } from '@/lib/execution/costs/types';

/**
 * The contract's sections for the costs filter and the entry form, asked when
 * the costs list opens and then a page at a time ("more sections"), so neither
 * the page nor one answer grows with the number of sections. Titles only: a
 * role that records costs may not see the contract's money.
 */
export function useCostSections(contractId: string) {
  const te = useTranslations('errors');
  const t = useTranslations('contracts.costs');
  const [sections, setSections] = useState<CostSection[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(afterSectionId: string | null) {
    startTransition(async () => {
      let refusal: ShownFailure;
      try {
        const result = await loadCostSections({ contractId, afterSectionId });
        if (result.ok && result.data) {
          const page = result.data;
          setFailure(null);
          setSections((shown) => {
            const known = new Set(shown.map((section) => section.id));
            return [...shown, ...page.sections.filter((section) => !known.has(section.id))];
          });
          setHasMore(page.hasMore);
          return;
        }
        refusal = result;
      } catch (rejection) {
        refusal = { rejection };
      }
      setFailure(describeReadFailure(refusal, te, t('sectionsFailed')));
    });
  }

  const first = useRef(() => ask(null));
  useEffect(() => first.current(), []);

  return {
    sections,
    hasMore,
    pending,
    failure,
    loadMore: () => ask(sections.at(-1)?.id ?? null),
  };
}

export type CostSectionsApi = ReturnType<typeof useCostSections>;
